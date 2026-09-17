import json
import tempfile
import unittest
from pathlib import Path
from redencut_speech_worker.preflight import inspect_runtime
from redencut_speech_worker.provisioning import provision_models

class WhisperAlternativesTest(unittest.TestCase):
    def test_default_preparation_does_not_download_or_require_optional_whisper(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / 'models.json'
            manifest.write_text(json.dumps({'models': [{
                'id': 'medium', 'capability': 'transcription', 'repository': 'test/model',
                'revision': 'rev', 'expectedFiles': ['model.bin'],
                'selection': {'family': 'whisper', 'variant': 'medium', 'recommended': False},
            }]}))
            token = root / 'token'
            token.write_text('synthetic-test-token')
            def unexpected(**kwargs):
                raise AssertionError('Optional model must not download by default')
            provision_models(manifest_path=manifest, cache_root=root/'cache', token_path=token, download_snapshot=unexpected)
            result = inspect_runtime(manifest_path=manifest, cache_root=root/'cache', package_versions={}, machine='arm64', backend='cpu')
            self.assertEqual(result['missingModelIds'], [])
