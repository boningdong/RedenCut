import io
import json
import unittest
from unittest.mock import patch
from redencut_speech_worker.__main__ import run

class OptionalDiarizationTests(unittest.TestCase):
    def test_disabled_does_not_call_diarization(self):
        request = {"protocolVersion": 1, "jobId": "test", "audioPath": "/tmp/a.wav", "language": "en", "transcriptUnits": [], "models": {"alignment": "alignment-en"}, "config": {"device": "cpu", "speakerRecognitionEnabled": False}}
        output = io.StringIO()
        with patch('redencut_speech_worker.__main__.align', return_value={}), patch('redencut_speech_worker.__main__.diarize') as diarize:
            self.assertEqual(run(io.StringIO(json.dumps(request)), output), 0)
            diarize.assert_not_called()
        result = json.loads(output.getvalue().splitlines()[-1])["result"]
        self.assertEqual(result['diarization'], {'status': 'skipped-disabled'})

    def test_diarization_failure_never_becomes_skipped_success(self):
        request = {"protocolVersion": 1, "jobId": "test", "audioPath": "/tmp/a.wav", "language": "en", "transcriptUnits": [], "models": {"alignment": "alignment-en", "diarization": "diarization-default"}, "config": {"device": "cpu", "speakerRecognitionEnabled": True}}
        output = io.StringIO()
        with patch('redencut_speech_worker.__main__.align', return_value={}), patch('redencut_speech_worker.__main__.diarize', side_effect=RuntimeError('failed')):
            self.assertEqual(run(io.StringIO(json.dumps(request)), output), 2)
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(messages[-1]['type'], 'error')
        self.assertFalse(any(message['type'] == 'result' for message in messages))

    def test_disabled_preflight_ignores_missing_diarization_model(self):
        import tempfile
        from pathlib import Path
        from redencut_speech_worker.preflight import inspect_runtime
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            manifest = root / 'models.json'
            manifest.write_text(json.dumps({'models': [{'id': 'speaker', 'capability': 'diarization', 'revision': 'abc', 'expectedFiles': ['model.bin']}]}))
            result = inspect_runtime(manifest_path=manifest, cache_root=root, package_versions={}, machine='arm64', backend='cpu', speaker_recognition_enabled=False)
            self.assertEqual(result['status'], 'ready')
