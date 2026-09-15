import io
import json
import unittest
from contextlib import redirect_stderr
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from redencut_speech_worker.__main__ import run


class DiarizationProgressTest(unittest.TestCase):
    def test_pipeline_hooks_emit_activity_without_substep_percentages_or_stdout_noise(self):
        # Replace expensive model inference at the third-party boundary, retaining
        # the real hook adapter, diarization normalization and protocol writer.
        class Pipeline:
            def to(self, device):
                return self

            def __call__(self, audio, hook=None):
                print("third-party inference diagnostic")
                if hook is not None:
                    hook("segmentation", None, file=audio, total=10, completed=5)
                    hook("segmentation", None, file=audio, total=10, completed=10)
                    hook("embeddings", None, file=audio, total=4, completed=0)
                    hook("speaker_counting", object(), file=audio)
                return SimpleNamespace(speaker_diarization=SimpleNamespace(
                    itertracks=lambda **kwargs: [(SimpleNamespace(start=0.1, end=0.9), None, "speaker-a")],
                ))

        modules = {
            "torch": MagicMock(), "whisperx": MagicMock(),
            "pyannote.audio": SimpleNamespace(Pipeline=SimpleNamespace(from_pretrained=lambda *args, **kwargs: Pipeline())),
        }
        request = {
            "protocolVersion": 1, "jobId": "hook-test", "audioPath": "/tmp/a.wav",
            "language": "en", "transcriptUnits": [],
            "models": {"alignment": "alignment-en", "diarization": "diarization-default"},
            "config": {"device": "cpu", "speakerRecognitionEnabled": True},
        }
        model = {"snapshot": "/models/speaker", "repository": "pyannote/community", "revision": "rev"}
        output, diagnostics = io.StringIO(), io.StringIO()
        with patch.dict("sys.modules", modules), patch("redencut_speech_worker.__main__.align", return_value={}), patch("redencut_speech_worker.diarization.load_manifest_model", return_value=model), redirect_stderr(diagnostics):
            status = run(io.StringIO(json.dumps(request)), output)
        self.assertEqual(status, 0)
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        progress = [message for message in messages if message.get("stage") == "diarizing"]
        self.assertEqual(len(progress), 5)
        self.assertTrue(all("percent" not in message for message in progress))
        self.assertTrue(all(message["jobId"] == "hook-test" for message in progress))
        self.assertEqual(messages[-1]["result"]["diarization"]["turns"][0]["speakerLabel"], "SPEAKER_00")
        self.assertIn("third-party inference diagnostic", diagnostics.getvalue())
