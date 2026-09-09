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
            final_path = cache_root / model["id"] / model["revision"]
            if final_path.exists():
                _verify_expected_files(final_path, model["expectedFiles"])
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
                (staging_path / ".podcut-model.json").write_text(
                    json.dumps(
                        {
                            "id": model["id"],
                            "repository": model["repository"],
                            "revision": model["revision"],
                        },
                        separators=(",", ":"),
                        sort_keys=True,
                    ),
                    encoding="utf-8",
                )
                final_path.parent.mkdir(parents=True, exist_ok=True)
                os.replace(staging_path, final_path)
            finally:
                shutil.rmtree(staging_path, ignore_errors=True)
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)


def _verify_expected_files(root: Path, expected_files: Sequence[str]) -> None:
    missing = [path for path in expected_files if not (root / path).is_file()]
    if missing:
        raise ValueError(f"Model snapshot is incomplete: {', '.join(missing)}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Provision PodCut speech models")
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
