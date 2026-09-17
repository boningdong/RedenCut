import argparse
import json
import os
import shutil
import sys
import uuid
from pathlib import Path
from typing import Callable, Sequence


def provision_models(
    *,
    manifest_path: Path,
    cache_root: Path,
    token_path: Path,
    download_snapshot: Callable[..., str],
) -> None:
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    token = token_path.read_text(encoding="utf-8").strip()
    if not token:
        raise ValueError("Hugging Face token file is empty")

    staging_root = cache_root / ".staging"
    try:
        for model in manifest["models"]:
            if model.get("selection", {}).get("recommended") is False:
                continue
            final_path = cache_root / model["id"] / model["revision"]
            if final_path.exists():
                _verify_expected_files(final_path, model["expectedFiles"])
                _migrate_snapshot_marker(final_path, model)
                continue

            staging_path = staging_root / f"{model['id']}-{uuid.uuid4()}"
            staging_path.mkdir(parents=True)
            try:
                download_snapshot(
                    repo_id=model["repository"],
                    revision=model["revision"],
                    local_dir=str(staging_path),
                    allow_patterns=model["expectedFiles"],
                    token=token,
                )
                _verify_expected_files(staging_path, model["expectedFiles"])
                _write_snapshot_marker(staging_path, model)
                final_path.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging_path, final_path)
            finally:
                shutil.rmtree(staging_path, ignore_errors=True)
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def _migrate_snapshot_marker(snapshot: Path, model: dict) -> None:
    current = snapshot / ".redencut-model.json"
    # Prefer the newest marker; an invalid newer marker must not fall back to an older one.
    candidates = (current, snapshot / ".riffcut-model.json", snapshot / ".podcut-model.json")
    source = next((candidate for candidate in candidates if candidate.exists()), current)
    try:
        marker = json.loads(source.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, UnicodeDecodeError) as error:
        raise ValueError(f"Model snapshot marker is missing or invalid: {snapshot}") from error
    if not isinstance(marker, dict) or any(
        marker.get(key) != model[key] for key in ("id", "repository", "revision")
    ):
        raise ValueError(f"Model snapshot marker does not match the manifest: {snapshot}")
    if source != current:
        _write_snapshot_marker(snapshot, model)


def _write_snapshot_marker(snapshot: Path, model: dict) -> None:
    temporary = snapshot / f".redencut-model-{uuid.uuid4()}.tmp"
    try:
        temporary.write_text(
            json.dumps(
                {key: model[key] for key in ("id", "repository", "revision")},
                separators=(",", ":"), sort_keys=True,
            ),
            encoding="utf-8",
        )
        os.replace(temporary, snapshot / ".redencut-model.json")
    finally:
        temporary.unlink(missing_ok=True)


def _verify_expected_files(root: Path, expected_files: Sequence[str]) -> None:
    missing = [path for path in expected_files if not (root / path).is_file()]
    if missing:
        raise ValueError(f"Model snapshot is incomplete: {', '.join(missing)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision RedenCut speech models")
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--cache-root", type=Path, required=True)
    parser.add_argument("--token-path", type=Path, required=True)
    arguments = parser.parse_args()
    from huggingface_hub import snapshot_download

    provision_models(
        manifest_path=arguments.manifest,
        cache_root=arguments.cache_root,
        token_path=arguments.token_path,
        download_snapshot=snapshot_download,
    )
    print("speech models provisioned")
    return 0


if __name__ == "__main__":
    sys.exit(main())
