import json
import tempfile
import unittest
from pathlib import Path

from podcut_speech_worker.provisioning import provision_models


class ProvisioningTest(unittest.TestCase):
    def test_publishes_verified_snapshot_without_persisting_token(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "models.json"
            revision = "0123456789abcdef0123456789abcdef01234567"
            manifest.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "models": [
                            {
                                "id": "diarization-default",
                                "capability": "diarization",
                                "repository": "pyannote/example",
                                "revision": revision,
                                "expectedFiles": ["config.yaml", "model/weights.bin"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            token = root / "token"
            token.write_text("secret-value", encoding="utf-8")
            calls = []

            def download_snapshot(**arguments: object) -> str:
                calls.append(arguments)
                destination = Path(str(arguments["local_dir"]))
                (destination / "model").mkdir(parents=True)
                (destination / "config.yaml").write_text("pipeline: test", encoding="utf-8")
                (destination / "model" / "weights.bin").write_bytes(b"weights")
                return str(destination)

            provision_models(
                manifest_path=manifest,
                cache_root=root / "cache",
                token_path=token,
                download_snapshot=download_snapshot,
            )

            published = root / "cache" / "diarization-default" / revision
            self.assertTrue(published.is_dir())
            self.assertEqual((published / "config.yaml").read_text(), "pipeline: test")
            self.assertEqual(json.loads((published / ".podcut-model.json").read_text())["revision"], revision)
            self.assertEqual(calls[0]["repo_id"], "pyannote/example")
            self.assertEqual(calls[0]["revision"], revision)
            self.assertEqual(calls[0]["token"], "secret-value")
            self.assertFalse((root / "cache" / ".staging").exists())
            for path in published.rglob("*"):
                if path.is_file():
                    self.assertNotIn("secret-value", path.read_text(errors="ignore"))


if __name__ == "__main__":
    unittest.main()
