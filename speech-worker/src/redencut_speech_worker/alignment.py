import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from .alignment_segments import partition_units, prepare_segments


def _normalized(text: str) -> str:
    return "".join(character.lower() for character in text if character.isalnum())


def normalize_alignment(
    transcript_units: List[Dict[str, Any]],
    aligned_words: List[Dict[str, Any]],
    aligned_chars: List[Dict[str, Any]],
) -> Dict[str, Any]:
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
            if not any(item.get("start") is not None and item.get("end") is not None for item in matched):
                untimed_ids.add(unit["id"])
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
        for item in chars + words:
            for key in ("start", "end"):
                if item.get(key) is not None:
                    item[key] += offset
        output.append({"text": window["text"], "chars": chars, "words": words})
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
    normalized = {"units": [], "unalignedTranscriptUnitIds": []}
    results = iter(aligned.get("segments", []))
    for group in groups:
        if not group:
            continue
        segment = next(results, {})
        part = normalize_alignment(group, segment.get("words", []), segment.get("chars", []))
        normalized["units"].extend(part["units"])
        normalized["unalignedTranscriptUnitIds"].extend(part["unalignedTranscriptUnitIds"])
    normalized["provenance"] = {
        "engineId": "whisperx", "engineVersion": "3.8.6",
        "modelId": model["repository"], "modelVersion": model["revision"],
        "configHash": hashlib.sha256(json.dumps(request["config"], sort_keys=True).encode()).hexdigest(),
        "artifactSchemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    return normalized
