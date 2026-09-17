import argparse
import importlib.metadata
import json
import platform
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence


def inspect_runtime(
    *,
    manifest_path: Path,
    cache_root: Path,
    package_versions: Dict[str, str],
    machine: str,
    backend: str,
    speaker_recognition_enabled: bool = True,
    model_ids: Optional[List[str]] = None,
) -> dict:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    missing_model_ids: List[str] = []
    invalid_model_ids: List[str] = []
    for model in manifest["models"]:
        if model_ids is None and model.get("selection", {}).get("recommended") is False:
            continue
        if model_ids is not None and model["id"] not in model_ids:
            continue
        if not speaker_recognition_enabled and model["capability"] == "diarization":
            continue
        snapshot = cache_root / model["id"] / model["revision"]
        if any(not (snapshot / relative_path).is_file() for relative_path in model["expectedFiles"]):
            missing_model_ids.append(model["id"])
            continue
        marker_path = snapshot / ".redencut-model.json"
        try:
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
        except (FileNotFoundError, json.JSONDecodeError):
            invalid_model_ids.append(model["id"])
            continue
        if any(marker.get(key) != model[key] for key in ("id", "repository", "revision")):
            invalid_model_ids.append(model["id"])

    status = (
        "models-invalid"
        if invalid_model_ids
        else "models-missing"
        if missing_model_ids
        else "ready"
    )

    return {
        "status": status,
        "protocolVersion": 1,
        "architecture": machine,
        "backend": backend,
        "packages": package_versions,
        "missingModelIds": missing_model_ids,
        "invalidModelIds": invalid_model_ids,
    }


def main(
    argv: Optional[Sequence[str]] = None,
    *,
    package_versions: Optional[Dict[str, str]] = None,
    machine: Optional[str] = None,
    backend: Optional[str] = None,
) -> int:
    parser = argparse.ArgumentParser(description="Inspect the RedenCut speech worker runtime")
    parser.add_argument("--json", action="store_true", dest="as_json")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--skip-diarization", action="store_true")
    parser.add_argument("--model-id", action="append", dest="model_ids")
    arguments = parser.parse_args(argv)

    versions = package_versions or {
        package: importlib.metadata.version(package)
        for package in ("torch", "whisperx", "pyannote.audio")
    }
    result = inspect_runtime(
        manifest_path=arguments.manifest,
        cache_root=arguments.cache_root,
        package_versions=versions,
        machine=machine or platform.machine(),
        backend=backend or "cpu",
        speaker_recognition_enabled=not arguments.skip_diarization,
        model_ids=arguments.model_ids,
    )
    if arguments.as_json:
        print(json.dumps(result, separators=(",", ":"), sort_keys=True))
    else:
        print(result["status"])
    return {"ready": 0, "models-missing": 12, "models-invalid": 13}[result["status"]]


if __name__ == "__main__":
    sys.exit(main())
