import json
import io
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path

from riffcut_speech_worker.preflight import inspect_runtime, main


class PreflightTest(unittest.TestCase):
    def test_reports_missing_models_without_downloading(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "models.json"
            manifest.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "models": [
                            {
                                "id": "diarization-default",
                                "capability": "diarization",
                                "repository": "pyannote/speaker-diarization-community-1",
                                "revision": "0123456789abcdef0123456789abcdef01234567",
                                "expectedFiles": ["config.yaml"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            result = inspect_runtime(
                manifest_path=manifest,
                cache_root=root / "models",
                package_versions={
                    "torch": "2.8.0",
                    "whisperx": "3.4.2",
                    "pyannote.audio": "3.3.2",
                },
                machine="aarch64",
                backend="cpu",
            )

            self.assertEqual(result["status"], "models-missing")
            self.assertEqual(result["protocolVersion"], 1)
            self.assertEqual(result["architecture"], "aarch64")
            self.assertEqual(result["backend"], "cpu")
            self.assertEqual(result["packages"]["whisperx"], "3.4.2")
            self.assertEqual(result["missingModelIds"], ["diarization-default"])
            self.assertFalse((root / "models").exists())

    def test_cli_uses_a_distinct_exit_code_for_missing_models(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / "models.json"
            manifest.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "models": [
                            {
                                "id": "align-zh",
                                "capability": "alignment",
                                "repository": "example/alignment",
                                "revision": "0123456789abcdef0123456789abcdef01234567",
                                "expectedFiles": ["config.json"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            output = io.StringIO()

            with redirect_stdout(output):
                exit_code = main(
                    [
                        "--json",
                        "--manifest",
                        str(manifest),
                        "--cache-root",
                        str(root / "models"),
                    ],
                    package_versions={
                        "torch": "2.8.0",
                        "whisperx": "3.8.6",
                        "pyannote.audio": "4.0.7",
                    },
                    machine="aarch64",
                    backend="cpu",
                )

            self.assertEqual(exit_code, 12)
            self.assertEqual(json.loads(output.getvalue())["status"], "models-missing")

    def test_reports_files_without_matching_snapshot_marker_as_invalid(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            revision = "0123456789abcdef0123456789abcdef01234567"
            manifest = root / "models.json"
            manifest.write_text(
                json.dumps(
                    {
                        "schemaVersion": 1,
                        "models": [
                            {
                                "id": "align-zh",
                                "capability": "alignment",
                                "repository": "example/alignment",
                                "revision": revision,
                                "expectedFiles": ["config.json"],
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )
            snapshot = root / "models" / "align-zh" / revision
            snapshot.mkdir(parents=True)
            (snapshot / "config.json").write_text("{}", encoding="utf-8")

            result = inspect_runtime(
                manifest_path=manifest,
                cache_root=root / "models",
                package_versions={
                    "torch": "2.8.0",
                    "whisperx": "3.8.6",
                    "pyannote.audio": "4.0.7",
                },
                machine="aarch64",
                backend="cpu",
            )

            self.assertEqual(result["status"], "models-invalid")
            self.assertEqual(result["invalidModelIds"], ["align-zh"])


if __name__ == "__main__":
    unittest.main()
