import copy
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .alignment_quality import validate_audio_evidence
from .alignment_recovery import resolve_alignment, retry_local_alignment
from .alignment_segments import partition_units, prepare_segments


def _normalized(text: str) -> str:
    return "".join(character.lower() for character in text if character.isalnum())


def normalize_alignment(
    transcript_units: List[Dict[str, Any]],
    aligned_words: List[Dict[str, Any]],
    aligned_chars: List[Dict[str, Any]],
    *, audio=None, audio_offset=0,
) -> Dict[str, Any]:
    if audio is not None:
        return resolve_alignment(transcript_units, aligned_words, aligned_chars, audio, audio_offset)
    speech = [unit for unit in transcript_units if unit["kind"] == "speech"]
    aligned_ids = set()
    untimed_ids = set()
    output = []

    char_cursor = 0
    usable_chars = aligned_chars
    for unit in speech:
        target = _normalized(unit["text"])
        if not target:
            continue
        matched = []
        accumulated = ""
        cursor = char_cursor
        while cursor < len(usable_chars) and len(accumulated) < len(target):
            candidate = _normalized(str(usable_chars[cursor].get("char", "")))
            cursor += 1
            if not candidate:
                continue
            accumulated += candidate
            matched.append(usable_chars[cursor - 1])
        if accumulated == target and matched:
            char_cursor = cursor
            if (any(item.get("audioEvidenceRejected") for item in matched)
                    or not any(item.get("start") is not None and item.get("end") is not None for item in matched)):
                untimed_ids.add(unit["id"])
            if any(item.get("audioEvidenceRejected") for item in matched):
                continue
            if any(item.get("start") is None or item.get("end") is None or item["start"] >= item["end"] for item in matched):
                continue
            scores = [float(item["score"]) for item in matched if item.get("score") is not None]
            output.append({
                "transcriptUnitIds": [unit["id"]],
                "sourceStart": float(matched[0]["start"]),
                "sourceEnd": float(matched[-1]["end"]),
                "granularity": "character" if len(target) == 1 else "word",
                **({"confidence": min(scores)} if scores else {}),
            })
            aligned_ids.add(unit["id"])
            char_cursor = cursor

    remaining = speech
    remaining_cursor = 0
    for word in aligned_words:
        target = _normalized(str(word.get("word", "")))
        if not target:
            continue
        matched_units = []
        accumulated = ""
        cursor = remaining_cursor
        while cursor < len(remaining) and len(accumulated) < len(target):
            matched_units.append(remaining[cursor])
            accumulated += _normalized(remaining[cursor]["text"])
            cursor += 1
        if accumulated != target:
            continue
        remaining_cursor = cursor
        if (word.get("start") is None or word.get("end") is None or word["start"] >= word["end"]
                or any(unit["id"] in aligned_ids or unit["id"] in untimed_ids for unit in matched_units)):
            continue
        output.append({
            "transcriptUnitIds": [unit["id"] for unit in matched_units],
            "sourceStart": float(word["start"]),
            "sourceEnd": float(word["end"]),
            "granularity": "word" if len(matched_units) == 1 else "phrase",
            **({"confidence": float(word["score"])} if word.get("score") is not None else {}),
        })
        aligned_ids.update(unit["id"] for unit in matched_units)
        remaining_cursor = cursor

    order = {unit["id"]: index for index, unit in enumerate(transcript_units)}
    return {
        "units": sorted(output, key=lambda unit: order[unit["transcriptUnitIds"][0]]),
        "unalignedTranscriptUnitIds": [unit["id"] for unit in speech if unit["id"] not in aligned_ids],
    }


def load_manifest_model(manifest_path: str, cache_root: str, model_id: str, model_paths: Optional[Dict[str, str]] = None) -> Dict[str, str]:
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    model = next((item for item in manifest["models"] if item["id"] == model_id), None)
    if model is None or model["capability"] != "alignment":
        raise ValueError(f"unknown alignment model: {model_id}")
    if model_paths is not None and model_id not in model_paths:
        raise FileNotFoundError(f"managed model not available: {model_id}")
    snapshot = Path(model_paths[model_id]) if model_paths is not None else Path(cache_root) / model["id"] / model["revision"]
    if not snapshot.is_dir():
        raise FileNotFoundError(f"alignment model is not provisioned: {model_id}")
    return {**model, "snapshot": str(snapshot)}


def run_whisperx_alignment(*, audio_path: str, text: str, language: str, device: str,
                           model_path: str, segments: Optional[List[Dict[str, Any]]] = None,
                           on_progress: Optional[Callable[[float], None]] = None) -> Dict[str, Any]:
    import whisperx

    audio = whisperx.load_audio(audio_path)
    windows = prepare_segments(text, segments, len(audio) / 16000)
    if not windows:
        return {"segments": [], "word_segments": []}
    model, metadata = whisperx.load_align_model(
        language_code=language, device=device, model_name=model_path, model_cache_only=True,
    )
    output = []
    for index, window in enumerate(windows):
        first, last = int(window["start"] * 16000), int(window["end"] * 16000)
        offset = first / 16000
        clip = audio[first:last]
        if last <= first:
            # A zero-duration recognition artifact has no acoustic evidence to refine.
            output.append({"text": window["text"], "chars": [], "words": []})
            if on_progress is not None:
                on_progress(100 * (index + 1) / len(windows))
            continue
        aligned = whisperx.align(
            [{"start": 0.0, "end": len(clip) / 16000, "text": window["text"]}],
            model, metadata, clip, device, return_char_alignments=True, interpolate_method="ignore",
        )
        chars = [dict(char) for segment in aligned.get("segments", []) for char in segment.get("chars", [])]
        words = [dict(word) for word in aligned.get("word_segments", [])]
        validate_audio_evidence(chars, clip)
        validate_audio_evidence(words, clip)
        raw_chars = copy.deepcopy(chars)
        def infer_retry(retry_text, retry_clip):
            return whisperx.align(
                [{"start": 0.0, "end": len(retry_clip) / 16000, "text": retry_text}],
                model, metadata, retry_clip, device, return_char_alignments=True,
                interpolate_method="ignore",
            )
        chars = retry_local_alignment(chars, clip, infer_retry)
        for item in chars + words + raw_chars:
            for key in ("start", "end"):
                if item.get(key) is not None:
                    item[key] += offset
        output.append({"text": window["text"], "chars": chars, "words": words,
                       "rawChars": raw_chars, "audio": clip, "audioOffset": offset,
                       "contextStart": window["start"], "contextEnd": window["end"]})
        if on_progress is not None:
            on_progress(100 * (index + 1) / len(windows))
    return {"segments": output, "word_segments": [word for segment in output for word in segment["words"]]}


def align(request: Dict[str, Any], on_progress: Optional[Callable[[float], None]] = None) -> Dict[str, Any]:
    model = load_manifest_model(
        os.environ.get("REDENCUT_SPEECH_MANIFEST", "/opt/redencut-speech-worker/models.json"),
        os.environ.get("REDENCUT_SPEECH_MODEL_CACHE", "/models"),
        request["models"]["alignment"],
        request.get("modelPaths"),
    )
    text = "".join(unit["text"] for unit in request["transcriptUnits"])
    segments = request.get("alignmentSegments")
    if segments:
        groups = partition_units(request["transcriptUnits"], [segment["text"] for segment in segments])
        # Preserve spaces required by English aligners; canonical units omit whitespace.
        text = " ".join(segment["text"] for segment in segments)
    else:
        groups = [request["transcriptUnits"]]
    aligned = run_whisperx_alignment(
        audio_path=request["audioPath"], text=text, language=request["language"],
        device=request["config"]["device"], model_path=model["snapshot"],
        segments=segments, on_progress=on_progress,
    )
    normalized = {"units": [], "unalignedTranscriptUnitIds": [], "observations": [], "recoveryVersion": 1}
    results = iter(aligned.get("segments", []))
    for group in groups:
        if not group:
            continue
        segment = next(results, {})
        words = list(segment.get("words", []))
        if segment.get("contextStart") is not None:
            words.append({"word": segment["text"], "start": segment["contextStart"], "end": segment["contextEnd"], "contextCandidate": True})
        part = resolve_alignment(group, words, segment.get("chars", []), segment.get("audio"), segment.get("audioOffset", 0))
        raw = resolve_alignment(group, segment.get("words", []), segment.get("rawChars", segment.get("chars", [])), segment.get("audio"), segment.get("audioOffset", 0))
        normalized["observations"].extend(raw["observations"])
        normalized["observations"].extend({**observation, "timingOrigin": "local-realigned"}
            for observation, unit in zip(part["observations"], [u for u in group if u["kind"] == "speech"])
            if any(unit["id"] in timing["transcriptUnitIds"] and timing["timingOrigin"] == "local-realigned" for timing in part["units"]))
        normalized["units"].extend(part["units"])
        normalized["unalignedTranscriptUnitIds"].extend(part["unalignedTranscriptUnitIds"])
    normalized["validation"] = {"version": 1, "method": "audio-evidence"}
    normalized["provenance"] = {
        "engineId": "whisperx", "engineVersion": "3.8.6",
        "modelId": model["repository"], "modelVersion": model["revision"],
        "configHash": hashlib.sha256(json.dumps(request["config"], sort_keys=True).encode()).hexdigest(),
        "artifactSchemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    normalized["recoveryProvenance"] = {
        "algorithmId": "bounded-alignment-recovery", "algorithmVersion": "1",
        "configHash": normalized["provenance"]["configHash"], "artifactSchemaVersion": 1,
        "createdAt": normalized["provenance"]["createdAt"],
    }
    return normalized
