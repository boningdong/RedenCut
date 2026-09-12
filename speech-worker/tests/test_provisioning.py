import json
import tempfile
import unittest
from pathlib import Path

from riffcut_speech_worker.provisioning import provision_models
from riffcut_speech_worker.preflight import inspect_runtime


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
            self.assertEqual(json.loads((published / ".riffcut-model.json").read_text())["revision"], revision)
            self.assertEqual(calls[0]["repo_id"], "pyannote/example")
            self.assertEqual(calls[0]["revision"], revision)
            self.assertEqual(calls[0]["token"], "secret-value")
            self.assertFalse((root / "cache" / ".staging").exists())
            for path in published.rglob("*"):
                if path.is_file():
                    self.assertNotIn("secret-value", path.read_text(errors="ignore"))


    def test_migrates_verified_legacy_cache_without_downloading_or_changing_models(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root, model, arguments = self.existing_snapshot(directory)
            snapshot = arguments["cache_root"] / model["id"] / model["revision"]
            legacy = snapshot / ".podcut-model.json"
            legacy.write_text(json.dumps({key: model[key] for key in ("id", "repository", "revision")}))
            legacy_bytes = legacy.read_bytes()
            weights = snapshot / "model.bin"
            weights_stat = weights.stat()

            provision_models(**arguments)

            result = inspect_runtime(
                manifest_path=arguments["manifest_path"], cache_root=arguments["cache_root"],
                package_versions={}, machine="test", backend="cpu",
            )
            self.assertEqual(result["status"], "ready")
            self.assertEqual(weights.read_bytes(), b"original-weights")
            self.assertEqual(weights.stat().st_mtime_ns, weights_stat.st_mtime_ns)
            self.assertEqual(legacy.read_bytes(), legacy_bytes)
            marker = snapshot / ".riffcut-model.json"
            marker_stat = marker.stat()
            provision_models(**arguments)
            self.assertEqual(marker.stat().st_mtime_ns, marker_stat.st_mtime_ns)
            self.assertNotIn("synthetic-token", marker.read_text())

    def test_rejects_unverifiable_existing_snapshots_without_certifying_them(self) -> None:
        invalid_markers = [None, "{broken", "[]", "null"]
        for key in ("id", "repository", "revision"):
            marker = {"id": "example", "repository": "example/model", "revision": "a" * 40}
            marker[key] = "wrong"
            invalid_markers.append(json.dumps(marker))
        for marker_text in invalid_markers:
            with self.subTest(marker=marker_text), tempfile.TemporaryDirectory() as directory:
                root, model, arguments = self.existing_snapshot(directory)
                snapshot = arguments["cache_root"] / model["id"] / model["revision"]
                if marker_text is not None:
                    (snapshot / ".podcut-model.json").write_text(marker_text)
                with self.assertRaises(ValueError):
                    provision_models(**arguments)
                self.assertFalse((snapshot / ".riffcut-model.json").exists())
                self.assertEqual((snapshot / "model.bin").read_bytes(), b"original-weights")

    def test_rejects_invalid_current_marker_even_with_valid_legacy_marker(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root, model, arguments = self.existing_snapshot(directory)
            snapshot = arguments["cache_root"] / model["id"] / model["revision"]
            (snapshot / ".podcut-model.json").write_text(json.dumps(model))
            current = snapshot / ".riffcut-model.json"
            current.write_text('{"revision":"wrong"}')
            with self.assertRaises(ValueError):
                provision_models(**arguments)
            self.assertEqual(current.read_text(), '{"revision":"wrong"}')

    def test_does_not_migrate_an_incomplete_legacy_snapshot(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root, model, arguments = self.existing_snapshot(directory)
            snapshot = arguments["cache_root"] / model["id"] / model["revision"]
            (snapshot / ".podcut-model.json").write_text(json.dumps(model))
            (snapshot / "model.bin").unlink()
            with self.assertRaisesRegex(ValueError, "incomplete"):
                provision_models(**arguments)
            self.assertFalse((snapshot / ".riffcut-model.json").exists())

    @staticmethod
    def existing_snapshot(directory):
        root = Path(directory)
        model = {"id": "example", "repository": "example/model", "revision": "a" * 40,
                 "expectedFiles": ["model.bin"]}
        manifest = root / "models.json"
        manifest.write_text(json.dumps({"models": [model]}))
        token = root / "token"
        token.write_text("synthetic-token")
        snapshot = root / "cache" / model["id"] / model["revision"]
        snapshot.mkdir(parents=True)
        (snapshot / "model.bin").write_bytes(b"original-weights")

        def no_download(**arguments):
            raise AssertionError("Existing validated snapshots must not be downloaded")

        return root, model, dict(manifest_path=manifest, cache_root=root / "cache",
                                 token_path=token, download_snapshot=no_download)


if __name__ == "__main__":
    unittest.main()
