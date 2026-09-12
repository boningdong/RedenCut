import unittest
from unittest.mock import patch

from redencut_speech_worker.diarization import diarize, normalize_turns


class DiarizationTest(unittest.TestCase):
    def test_normalizes_anonymous_speakers_by_first_appearance_and_keeps_overlap(self):
        turns = normalize_turns([
            {"label": "speaker-z", "start": 1.0, "end": 3.0},
            {"label": "speaker-a", "start": 2.0, "end": 4.0},
            {"label": "speaker-z", "start": 5.0, "end": 6.0},
        ])
        self.assertEqual(["SPEAKER_00", "SPEAKER_01", "SPEAKER_00"], [turn["speakerLabel"] for turn in turns])
        self.assertEqual((1.0, 3.0), (turns[0]["sourceStart"], turns[0]["sourceEnd"]))
        self.assertLess(turns[1]["sourceStart"], turns[0]["sourceEnd"])

    def test_rejects_non_finite_or_empty_ranges(self):
        with self.assertRaises(ValueError):
            normalize_turns([{"label": "x", "start": 1.0, "end": 1.0}])
        with self.assertRaises(ValueError):
            normalize_turns([{"label": "x", "start": float("nan"), "end": 2.0}])

    @patch("redencut_speech_worker.diarization.run_pyannote")
    @patch("redencut_speech_worker.diarization.load_manifest_model")
    def test_adapter_loads_the_manifest_snapshot_offline(self, load_model, run_pyannote):
        load_model.return_value = {
            "id": "diarization-default", "repository": "pyannote/community",
            "revision": "immutable-rev", "snapshot": "/models/diarization-default/immutable-rev",
        }
        run_pyannote.return_value = [{"label": "x", "start": 0.1, "end": 0.9}]
        output = diarize({
            "audioPath": "/tmp/source.wav", "models": {"diarization": "diarization-default"},
            "config": {"device": "cpu"},
        })
        self.assertEqual("/models/diarization-default/immutable-rev", run_pyannote.call_args.kwargs["model_path"])
        self.assertEqual("pyannote/community", output["provenance"]["modelId"])
        self.assertNotIn("token", str(output).lower())


if __name__ == "__main__":
    unittest.main()
