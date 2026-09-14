"""Load a staged managed model before the main process publishes its installation."""
import argparse
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional, Sequence


def load_alignment(language: str, path: Path) -> None:
    import whisperx

    whisperx.load_align_model(
        language_code=language,
        device="cpu",
        model_name=str(path),
        model_cache_only=True,
    )


def load_diarization(path: Path) -> None:
    from pyannote.audio import Pipeline

    pipeline = Pipeline.from_pretrained(path / "config.yaml", token=False)
    if pipeline is None:
        raise RuntimeError("diarization model could not be loaded")


def validate_model(model: Dict[str, Any], path: Path) -> None:
    for key in ("HF_TOKEN", "HUGGING_FACE_HUB_TOKEN", "HUGGINGFACE_TOKEN", "HF_TOKEN_PATH"):
        os.environ.pop(key, None)
    os.environ.update(HF_HUB_OFFLINE="1", TRANSFORMERS_OFFLINE="1", HF_HUB_DISABLE_IMPLICIT_TOKEN="1")
    if model["capability"] == "alignment":
        languages = model.get("supportedLanguages", [])
        if len(languages) != 1 or languages[0] not in ("en", "zh"):
            raise ValueError("alignment validation requires one supported language")
        load_alignment(languages[0], path)
    elif model["capability"] == "diarization":
        load_diarization(path)
    else:
        raise ValueError("this model requires native transcription validation")


def main(argv: Optional[Sequence[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--model-id", required=True)
    parser.add_argument("--path", type=Path, required=True)
    args = parser.parse_args(argv)
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    model = next((model for model in manifest["models"] if model["id"] == args.model_id), None)
    if model is None:
        raise ValueError("unknown managed model")
    validate_model(model, args.path)
    print(json.dumps({"status": "validated", "modelId": args.model_id}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
