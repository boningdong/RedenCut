import hashlib
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List


def normalize_turns(raw_turns: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    ordered = sorted(raw_turns, key=lambda turn: (turn["start"], turn["end"], turn["label"]))
    labels: Dict[str, str] = {}
    result = []
    for turn in ordered:
        start, end = float(turn["start"]), float(turn["end"])
        if not math.isfinite(start) or not math.isfinite(end) or start < 0 or start >= end:
            raise ValueError("diarization turn requires a finite positive range")
        source_label = str(turn["label"])
        label = labels.setdefault(source_label, f"SPEAKER_{len(labels):02d}")
        result.append({
            "speakerLabel": label,
            "sourceStart": start,
            "sourceEnd": end,
            **({"confidence": float(turn["confidence"])} if turn.get("confidence") is not None else {}),
        })
    return result


def load_manifest_model(manifest_path: str, cache_root: str, model_id: str) -> Dict[str, str]:
    manifest = json.loads(Path(manifest_path).read_text(encoding="utf-8"))
    model = next((item for item in manifest["models"] if item["id"] == model_id), None)
    if model is None or model["capability"] != "diarization":
        raise ValueError(f"unknown diarization model: {model_id}")
    snapshot = Path(cache_root) / model["id"] / model["revision"]
    if not (snapshot / "config.yaml").is_file():
        raise FileNotFoundError(f"diarization model is not provisioned: {model_id}")
    return {**model, "snapshot": str(snapshot)}


def run_pyannote(*, audio_path: str, device: str, model_path: str) -> List[Dict[str, Any]]:
    import torch
    import whisperx
    from pyannote.audio import Pipeline

    audio = whisperx.load_audio(audio_path)
    waveform = torch.from_numpy(audio).unsqueeze(0)
    pipeline = Pipeline.from_pretrained(Path(model_path) / "config.yaml", token=False)
    if pipeline is None:
        raise RuntimeError("pyannote failed to load the provisioned pipeline")
    pipeline.to(torch.device(device))
    output = pipeline({"waveform": waveform, "sample_rate": 16000})
    annotation = getattr(output, "speaker_diarization", output)
    return [
        {"label": label, "start": float(segment.start), "end": float(segment.end)}
        for segment, _, label in annotation.itertracks(yield_label=True)
    ]


def diarize(request: Dict[str, Any]) -> Dict[str, Any]:
    model = load_manifest_model(
        os.environ.get("RIFFCUT_SPEECH_MANIFEST", "/opt/riffcut-speech-worker/models.json"),
        os.environ.get("RIFFCUT_SPEECH_MODEL_CACHE", "/models"),
        request["models"]["diarization"],
    )
    turns = normalize_turns(run_pyannote(
        audio_path=request["audioPath"], device=request["config"]["device"],
        model_path=model["snapshot"],
    ))
    return {
        "turns": turns,
        "provenance": {
            "engineId": "pyannote.audio", "engineVersion": "4.0.7",
            "modelId": model["repository"], "modelVersion": model["revision"],
            "configHash": hashlib.sha256(json.dumps(request["config"], sort_keys=True).encode()).hexdigest(),
            "artifactSchemaVersion": 1,
            "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        },
    }
