import unittest
from unittest.mock import patch

from riffcut_speech_worker.alignment import align, normalize_alignment


UNITS = [
    {"id": "u1", "text": "觉", "kind": "speech"},
    {"id": "u2", "text": "得", "kind": "speech"},
    {"id": "p1", "text": "。", "kind": "punctuation"},
    {"id": "u3", "text": "okay", "kind": "speech"},
]


class AlignmentTest(unittest.TestCase):
    def test_groups_units_when_only_a_phrase_boundary_is_reliable(self):
        result = normalize_alignment(UNITS, [
            {"word": "觉得", "start": 0.75, "end": 1.18, "score": 0.9},
            {"word": "okay", "start": 1.3, "end": 1.7},
        ], [])
        self.assertEqual(["u1", "u2"], result["units"][0]["transcriptUnitIds"])
        self.assertEqual((0.75, 1.18), (result["units"][0]["sourceStart"], result["units"][0]["sourceEnd"]))
        self.assertNotIn("p1", [unit for group in result["units"] for unit in group["transcriptUnitIds"]])
        self.assertEqual([], result["unalignedTranscriptUnitIds"])

    def test_uses_real_character_boundaries_without_average_splitting(self):
        result = normalize_alignment(UNITS[:3], [], [
            {"char": "觉", "start": 0.75, "end": 0.91, "score": 0.8},
            {"char": "得", "start": 0.96, "end": 1.18, "score": 0.9},
        ])
        self.assertEqual([0.75, 0.96], [group["sourceStart"] for group in result["units"]])
        self.assertEqual(["character", "character"], [group["granularity"] for group in result["units"]])

    def test_reports_unaligned_speech_explicitly(self):
        result = normalize_alignment(UNITS, [{"word": "觉得", "start": 0.75, "end": 1.18}], [])
        self.assertEqual(["u3"], result["unalignedTranscriptUnitIds"])

    @patch("riffcut_speech_worker.alignment.run_whisperx_alignment")
    def test_adapter_uses_manifest_pinned_snapshot_offline(self, run_alignment):
        run_alignment.return_value = {"word_segments": [], "segments": []}
        request = {
            "audioPath": "/tmp/source.wav", "language": "zh",
            "transcriptUnits": UNITS, "models": {"alignment": "alignment-zh"},
            "config": {"device": "cpu"},
        }
        with patch.dict("os.environ", {"RIFFCUT_SPEECH_MODEL_CACHE": "/models", "RIFFCUT_SPEECH_MANIFEST": "/manifest.json"}), \
             patch("riffcut_speech_worker.alignment.load_manifest_model", return_value={
                 "id": "alignment-zh", "repository": "repo", "revision": "rev", "snapshot": "/models/alignment-zh/rev"
             }):
            result = align(request)
        self.assertEqual("/models/alignment-zh/rev", run_alignment.call_args.kwargs["model_path"])
        self.assertEqual(["u1", "u2", "u3"], result["unalignedTranscriptUnitIds"])


if __name__ == "__main__":
    unittest.main()
