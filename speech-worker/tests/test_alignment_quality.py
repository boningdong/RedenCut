import unittest

import numpy as np

from redencut_speech_worker.alignment_quality import validate_audio_evidence


class AlignmentQualityTest(unittest.TestCase):
    def test_only_the_candidate_span_supplies_evidence(self):
        audio = np.ones(16000, dtype=np.float32)
        audio[1600:3200] = 0
        item = {"start": .1, "end": .2, "score": .99}
        validate_audio_evidence([item], audio)
        self.assertTrue(item["audioEvidenceRejected"])
        self.assertEqual((.1, .2), (item["start"], item["end"]))

    def test_invalid_bounds_and_scores_never_reach_audio_slicing(self):
        for bounds in [(float("nan"), .2), (.1, float("inf")), (-.1, .2), (.1, 1.1), (.2, .1)]:
            with self.subTest(bounds=bounds):
                item = {"start": bounds[0], "end": bounds[1], "score": .9}
                validate_audio_evidence([item], np.ones(16000, dtype=np.float32))
                self.assertTrue(item["audioEvidenceRejected"])
        for score in [float("nan"), float("inf"), -.1, 0, 1.1]:
            with self.subTest(score=score):
                item = {"start": .1, "end": .2, "score": score}
                validate_audio_evidence([item], np.ones(16000, dtype=np.float32))
                self.assertTrue(item["audioEvidenceRejected"])

    def test_no_pause_truncation_or_boundary_invention(self):
        audio = np.zeros(16000, dtype=np.float32)
        audio[1600:3200] = .01
        item = {"start": 0., "end": 1., "score": .8}
        validate_audio_evidence([item], audio)
        self.assertEqual((0., 1., .8), (item["start"], item["end"], item["score"]))
        self.assertEqual("non-silent", item["audioEvidence"])
