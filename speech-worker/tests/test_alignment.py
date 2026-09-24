import unittest
from unittest.mock import patch, Mock
import numpy as np
import sys
import tempfile
import json
from pathlib import Path
from types import SimpleNamespace

from redencut_speech_worker.alignment import align, normalize_alignment, run_whisperx_alignment, load_manifest_model
from redencut_speech_worker.alignment_segments import partition_units, prepare_segments
from redencut_speech_worker.failures import AlignmentFailure


UNITS = [
    {"id": "u1", "text": "觉", "kind": "speech"},
    {"id": "u2", "text": "得", "kind": "speech"},
    {"id": "p1", "text": "。", "kind": "punctuation"},
    {"id": "u3", "text": "okay", "kind": "speech"},
]


class AlignmentTest(unittest.TestCase):
    def test_typed_alignment_input_failures(self):
        with self.assertRaises(AlignmentFailure) as mismatch:
            partition_units([{"id": "u", "text": "hello", "kind": "speech"}], ["hel", "lo"])
        self.assertEqual("alignment-segment-mismatch", mismatch.exception.code)
        with self.assertRaises(AlignmentFailure) as timing:
            prepare_segments("hello", [{"text": "he", "sourceStart": 2, "sourceEnd": 3},
                                       {"text": "llo", "sourceStart": 1, "sourceEnd": 2}], 4)
        self.assertEqual("alignment-timing-invalid", timing.exception.code)
        with self.assertRaises(AlignmentFailure) as window:
            prepare_segments("hello", [{"text": "hello", "sourceStart": 0, "sourceEnd": 31}], 31)
        self.assertEqual("alignment-window-too-long", window.exception.code)
        self.assertEqual(31, window.exception.details["durationSeconds"])

    def test_missing_alignment_snapshot_is_typed(self):
        with tempfile.TemporaryDirectory() as root:
            manifest = Path(root) / "models.json"
            manifest.write_text(json.dumps({"models": [{"id": "alignment-en", "capability": "alignment", "revision": "v1"}]}))
            with self.assertRaises(AlignmentFailure) as missing:
                load_manifest_model(str(manifest), root, "alignment-en")
            self.assertEqual("alignment-model-unavailable", missing.exception.code)

    def validated_alignment(self, audio, score=.9, segments=None):
        fake = SimpleNamespace(load_audio=lambda _: audio,
            load_align_model=Mock(return_value=(object(), {})), align=Mock(return_value={
                "segments": [{"chars": [{"char": "a", "start": .1, "end": .2, "score": score}]}],
                "word_segments": [{"word": "a", "start": .1, "end": .2, "score": .99}]}))
        with patch.dict(sys.modules, {"whisperx": fake}):
            result = run_whisperx_alignment(audio_path="audio.wav", text="a", language="en",
                device="cpu", model_path="model", segments=segments)
        segment = result["segments"][0]
        return normalize_alignment([{"id": "a", "text": "a", "kind": "speech"}],
                                   segment["words"], segment["chars"])

    def test_high_confidence_digital_silence_has_no_edit_bounds(self):
        result = self.validated_alignment(np.zeros(16000, dtype=np.float32), .99)
        self.assertEqual([], result["units"])
        self.assertEqual(["a"], result["unalignedTranscriptUnitIds"])

    def test_zero_score_cannot_be_readmitted_by_word_fallback(self):
        result = self.validated_alignment(np.ones(16000, dtype=np.float32) * .1, 0)
        self.assertEqual([], result["units"])
        self.assertEqual(["a"], result["unalignedTranscriptUnitIds"])

    def test_quiet_positive_score_keeps_original_bounds(self):
        audio = (np.sin(np.arange(16000) * .1) * 1e-8).astype(np.float32)
        result = self.validated_alignment(audio, .001)
        self.assertEqual([], result["unalignedTranscriptUnitIds"])
        self.assertEqual((.1, .2), (result["units"][0]["sourceStart"], result["units"][0]["sourceEnd"]))

    def test_audio_evidence_is_checked_before_absolute_offset(self):
        audio = np.zeros(10 * 16000, dtype=np.float32)
        audio[int(4.85 * 16000):int(4.95 * 16000)] = .01
        result = self.validated_alignment(audio, .8,
            [{"text": "a", "sourceStart": 5, "sourceEnd": 6}])
        self.assertEqual([], result["unalignedTranscriptUnitIds"])
        self.assertAlmostEqual(4.85, result["units"][0]["sourceStart"])

    def test_nonfinite_audio_cannot_support_an_edit(self):
        result = self.validated_alignment(np.full(16000, np.nan, dtype=np.float32))
        self.assertEqual([], result["units"])

    def test_fallback_rejects_interpolated_words_without_any_timed_characters(self):
        result = normalize_alignment([
            {"id": "a", "kind": "speech", "text": "hello"},
            {"id": "b", "kind": "speech", "text": "123"},
        ], [{"word": "hello", "start": 1, "end": 2}, {"word": "123", "start": 1, "end": 2}], [
            *[{"char": c, "start": 1, "end": 2} for c in "hello"],
            *[{"char": c} for c in "123"],
        ])
        self.assertEqual(["b"], result["unalignedTranscriptUnitIds"])

    def test_context_is_included_in_the_inference_duration_limit(self):
        def infer(segments, model, metadata, audio, device, **kwargs):
            self.assertLessEqual(len(audio), 30 * 16000)
            return {"segments": [], "word_segments": []}
        fake = SimpleNamespace(load_audio=lambda _: np.zeros(61 * 16000, dtype=np.float32),
                               load_align_model=Mock(return_value=(object(), {})), align=infer)
        with patch.dict(sys.modules, {"whisperx": fake}):
            run_whisperx_alignment(audio_path="audio.wav", text="hello", language="en",
                device="cpu", model_path="model", segments=[
                    {"text": "hello", "sourceStart": 10, "sourceEnd": 40}])

    def test_partial_word_timing_does_not_block_the_next_word(self):
        units = [{"id": "a", "kind": "speech", "text": "ab"}, {"id": "c", "kind": "speech", "text": "c"}]
        result = normalize_alignment(units, [], [
            {"char": "a", "start": 0, "end": .1}, {"char": "b"},
            {"char": "c", "start": .2, "end": .3},
        ])
        self.assertEqual(["a"], result["unalignedTranscriptUnitIds"])
        self.assertEqual(["c"], result["units"][0]["transcriptUnitIds"])

    def test_word_fallback_does_not_reassign_an_earlier_repeated_word(self):
        units = [{"id": "a", "kind": "speech", "text": "go"}, {"id": "b", "kind": "speech", "text": "go"}]
        result = normalize_alignment(units, [
            {"word": "go", "start": 0, "end": .2}, {"word": "go", "start": 1, "end": 1.2},
        ], [{"char": "g", "start": 0, "end": .1}, {"char": "o", "start": .1, "end": .2}])
        self.assertEqual(1, result["units"][1]["sourceStart"])

    def test_missing_character_timing_does_not_shift_later_units(self):
        result = normalize_alignment(UNITS[:3], [], [
            {"char": "觉"},
            {"char": "得", "start": 0.96, "end": 1.18},
        ])
        self.assertEqual(["u1"], result["unalignedTranscriptUnitIds"])
        self.assertEqual(["u2"], result["units"][0]["transcriptUnitIds"])

    def test_long_audio_is_inferred_in_bounded_windows_with_absolute_results(self):
        calls = []
        def infer(segments, model, metadata, audio, device, **kwargs):
            self.assertLessEqual(len(audio), 30 * 16000)
            self.assertEqual("ignore", kwargs.get("interpolate_method"))
            self.assertEqual(0, segments[0]["start"])
            calls.append(segments[0]["text"])
            return {"segments": [{"chars": [{"char": segments[0]["text"], "start": .1, "end": .2}]}],
                    "word_segments": []}
        fake = SimpleNamespace(load_audio=lambda _: np.ones(3877 * 16000, dtype=np.float32),
                               load_align_model=Mock(return_value=(object(), {})), align=infer)
        progress = []
        with patch.dict(sys.modules, {"whisperx": fake}):
            result = run_whisperx_alignment(audio_path="audio.wav", text="觉得", language="zh",
                device="cpu", model_path="model", segments=[
                    {"text": "觉", "sourceStart": 0, "sourceEnd": 10},
                    {"text": "得", "sourceStart": 3800, "sourceEnd": 3810},
                ], on_progress=progress.append)
        self.assertEqual(["觉", "得"], calls)
        self.assertAlmostEqual(3799.85, result["segments"][1]["chars"][0]["start"])
        self.assertEqual([50, 100], progress)
        fake.load_align_model.assert_called_once()

    def test_zero_duration_recognition_is_unaligned_without_blocking_later_segments(self):
        fake = SimpleNamespace(load_audio=lambda _: np.ones(10 * 16000, dtype=np.float32),
            load_align_model=Mock(return_value=(object(), {})), align=Mock(return_value={
                "segments": [{"chars": [{"char": "得", "start": .1, "end": .2}]}], "word_segments": []}))
        progress = []
        with patch.dict(sys.modules, {"whisperx": fake}):
            result = run_whisperx_alignment(audio_path="audio.wav", text="觉得", language="zh",
                device="cpu", model_path="model", segments=[
                    {"text": "觉", "sourceStart": 1, "sourceEnd": 1},
                    {"text": "得", "sourceStart": 2, "sourceEnd": 3}], on_progress=progress.append)
        self.assertEqual([], result["segments"][0]["chars"])
        self.assertAlmostEqual(1.85, result["segments"][1]["chars"][0]["start"])
        fake.align.assert_called_once()
        self.assertEqual([50, 100], progress)

    def test_long_audio_without_timing_never_reaches_inference(self):
        fake = SimpleNamespace(load_audio=lambda _: np.zeros(61 * 16000, dtype=np.float32),
                               load_align_model=Mock(return_value=(object(), {})), align=Mock(return_value={}))
        with patch.dict(sys.modules, {"whisperx": fake}), self.assertRaisesRegex(ValueError, "timing"):
            run_whisperx_alignment(audio_path="audio.wav", text="hello", language="en",
                                   device="cpu", model_path="model")
        fake.align.assert_not_called()

    def test_oversized_timed_segment_never_reaches_inference(self):
        fake = SimpleNamespace(load_audio=lambda _: np.zeros(61 * 16000, dtype=np.float32),
                               load_align_model=Mock(return_value=(object(), {})), align=Mock(return_value={}))
        with patch.dict(sys.modules, {"whisperx": fake}), self.assertRaisesRegex(ValueError, "30"):
            run_whisperx_alignment(audio_path="audio.wav", text="hello", language="en",
                device="cpu", model_path="model", segments=[
                    {"text": "hello", "sourceStart": 0, "sourceEnd": 61}])
        fake.align.assert_not_called()

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

    @patch("redencut_speech_worker.alignment.run_whisperx_alignment")
    def test_adapter_uses_manifest_pinned_snapshot_offline(self, run_alignment):
        run_alignment.return_value = {"word_segments": [], "segments": []}
        request = {
            "audioPath": "/tmp/source.wav", "language": "zh",
            "transcriptUnits": UNITS, "models": {"alignment": "alignment-zh"},
            "config": {"device": "cpu"},
        }
        with patch.dict("os.environ", {"REDENCUT_SPEECH_MODEL_CACHE": "/models", "REDENCUT_SPEECH_MANIFEST": "/manifest.json"}), \
             patch("redencut_speech_worker.alignment.load_manifest_model", return_value={
                 "id": "alignment-zh", "repository": "repo", "revision": "rev", "snapshot": "/models/alignment-zh/rev"
             }):
            result = align(request)
        self.assertEqual({"version": 1, "method": "audio-evidence"}, result["validation"])
        self.assertEqual("/models/alignment-zh/rev", run_alignment.call_args.kwargs["model_path"])
        self.assertEqual(["u1", "u2", "u3"], result["unalignedTranscriptUnitIds"])


if __name__ == "__main__":
    unittest.main()
