import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


def _normalized(text: str) -> str:
    return "".join(character.lower() for character in text if character.isalnum())


def normalize_alignment(
    transcript_units: List[Dict[str, Any]],
    aligned_words: List[Dict[str, Any]],
    aligned_chars: List[Dict[str, Any]],
) -> Dict[str, Any]:
    speech = [unit for unit in transcript_units if unit["kind"] == "speech"]
    aligned_ids = set()
    output = []

    char_cursor = 0
    usable_chars = [char for char in aligned_chars if char.get("start") is not None and char.get("end") is not None]
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

    remaining = [unit for unit in speech if unit["id"] not in aligned_ids]
    remaining_cursor = 0
    for word in aligned_words:
        if word.get("start") is None or word.get("end") is None:
            continue
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


def load_manifest_model(manifest_path: str, cache_root: str, model_id: str) -> Dict[str, str]:
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    model = next((item for item in manifest["models"] if item["id"] == model_id), None)
    if model is None or model["capability"] != "alignment":
        raise ValueError(f"unknown alignment model: {model_id}")
    snapshot = Path(cache_root) / model["id"] / model["revision"]
    if not snapshot.is_dir():
        raise FileNotFoundError(f"alignment model is not provisioned: {model_id}")
    return {**model, "snapshot": str(snapshot)}


def run_whisperx_alignment(*, audio_path: str, text: str, language: str, device: str, model_path: str) -> Dict[str, Any]:
    import whisperx

    audio = whisperx.load_audio(audio_path)
    duration = len(audio) / 16000
    model, metadata = whisperx.load_align_model(
        language_code=language, device=device, model_name=model_path, model_cache_only=True,
    )
    return whisperx.align(
        [{"start": 0.0, "end": duration, "text": text}], model, metadata,
        audio, device, return_char_alignments=True,
    )


def align(request: Dict[str, Any]) -> Dict[str, Any]:
    model = load_manifest_model(
        os.environ.get("REDENCUT_SPEECH_MANIFEST", "/opt/redencut-speech-worker/models.json"),
        os.environ.get("REDENCUT_SPEECH_MODEL_CACHE", "/models"),
        request["models"]["alignment"],
    )
    text = "".join(unit["text"] for unit in request["transcriptUnits"])
    aligned = run_whisperx_alignment(
        audio_path=request["audioPath"], text=text, language=request["language"],
        device=request["config"]["device"], model_path=model["snapshot"],
    )
    chars = [item for segment in aligned.get("segments", []) for item in segment.get("chars", [])]
    normalized = normalize_alignment(request["transcriptUnits"], aligned.get("word_segments", []), chars)
    normalized["provenance"] = {
        "engineId": "whisperx", "engineVersion": "3.8.6",
        "modelId": model["repository"], "modelVersion": model["revision"],
        "configHash": hashlib.sha256(json.dumps(request["config"], sort_keys=True).encode()).hexdigest(),
        "artifactSchemaVersion": 1,
        "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    return normalized
