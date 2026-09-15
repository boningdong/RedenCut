import unittest
import numpy as np
from redencut_speech_worker.alignment import normalize_alignment
from redencut_speech_worker.alignment_quality import validate_audio_evidence

def units(text):
    return [{'id': str(i), 'text': c, 'kind': 'speech'} for (i, c) in enumerate(text)]

class RecoveryTest(unittest.TestCase):

    def recover(self, text, chars, words=None, audio=None, offset=0):
        return normalize_alignment(units(text), words or [], chars, audio=audio if audio is not None else np.ones(30 * 16000), audio_offset=offset)

    def test_single_gap_uses_neighbor_anchors(self):
        chars = [{'char': '光', 'start': 17.5, 'end': 17.714}, {'char': '晖', 'start': 17.714, 'end': 17.714}, {'char': '在', 'start': 18.384, 'end': 18.5}]
        result = self.recover('光晖在', chars)
        recovered = result['units'][1]
        self.assertEqual((17.714, 18.384), (recovered['sourceStart'], recovered['sourceEnd']))
        self.assertEqual('anchor-inferred', recovered['timingOrigin'])
        self.assertEqual(['0', '2'], recovered['evidenceAnchorTextUnitIds'])
        self.assertEqual(17.714, result['observations'][1]['candidateEnd'])
        self.assertEqual(17.714, chars[1]['end'])

    def test_two_missing_units_share_interval(self):
        r = self.recover('甲乙丙丁', [{'char': '甲', 'start': 1, 'end': 1.2}, {'char': '乙'}, {'char': '丙'}, {'char': '丁', 'start': 1.8, 'end': 2}])
        group = r['units'][1]
        self.assertEqual(['1', '2'], group['transcriptUnitIds'])
        self.assertEqual((1.2, 1.8), (group['sourceStart'], group['sourceEnd']))
        self.assertEqual('group-fallback', group['timingOrigin'])

    def test_edge_word_fallback_is_not_character_split(self):
        r = self.recover('甲乙', [{'char': '甲'}, {'char': '乙'}], [{'word': '甲乙', 'start': 1, 'end': 1.5}])
        self.assertEqual(1, len(r['units']))
        self.assertEqual(['0', '1'], r['units'][0]['transcriptUnitIds'])
        self.assertEqual(1, r['units'][0]['sourceStart'])

    def test_silent_and_long_gaps_remain_unaligned(self):
        for (audio, end) in [(np.zeros(30 * 16000), 1.8), (np.ones(30 * 16000), 20)]:
            r = self.recover('甲乙丙', [{'char': '甲', 'start': 1, 'end': 1.2}, {'char': '乙'}, {'char': '丙', 'start': end, 'end': end + 0.2}], audio=audio)
            self.assertIn('1', r['unalignedTranscriptUnitIds'])

    def test_conflicting_interval_is_not_direct(self):
        r = self.recover('甲乙丙', [{'char': '甲', 'start': 1, 'end': 1.2}, {'char': '乙', 'start': 1.1, 'end': 1.3}, {'char': '丙', 'start': 1.8, 'end': 2}])
        self.assertEqual('anchor-inferred', r['units'][1]['timingOrigin'])
        self.assertEqual('conflict', r['observations'][1]['reason'])

    def test_evidence_preserves_raw_and_accepts_quiet_positive(self):
        item = {'start': 0.1, 'end': 0.2, 'score': 0.001, 'custom': 'preserve'}
        validate_audio_evidence([item], np.ones(16000) * 1e-10)
        self.assertEqual('non-silent', item['audioEvidence'])
        self.assertEqual('low-score', item['reason'])
        self.assertEqual('preserve', item['custom'])
        silent = {'start': 0.1, 'end': 0.2, 'score': 0.99}
        validate_audio_evidence([silent], np.zeros(16000))
        self.assertEqual(0.1, silent['start'])
        self.assertEqual('silence', silent['reason'])

    def test_source_offset_applies_to_audio_evidence(self):
        r = self.recover('甲乙丙', [{'char': '甲', 'start': 10, 'end': 10.2}, {'char': '乙'}, {'char': '丙', 'start': 10.8, 'end': 11}], audio=np.ones(16000), offset=10)
        self.assertEqual(10.2, r['units'][1]['sourceStart'])

class RetryTest(unittest.TestCase):

    def test_retry_budget_resets_per_window_and_preserves_original_evidence(self):
        from unittest.mock import Mock, patch
        from types import SimpleNamespace
        import sys
        from redencut_speech_worker.alignment import run_whisperx_alignment
        calls = []

        def infer(segments, model, metadata, audio, device, **kwargs):
            calls.append(len(audio) / 16000)
            recovered = len(calls) % 2 == 0
            return {'segments': [{'chars': [{'char': '甲', 'start': 0.1, 'end': 0.2 if recovered else 0.1}]}], 'word_segments': []}
        fake = SimpleNamespace(load_audio=lambda _: np.ones(20 * 16000), load_align_model=Mock(return_value=(object(), {})), align=infer)
        with patch.dict(sys.modules, {'whisperx': fake}):
            r = run_whisperx_alignment(audio_path='a', text='甲甲', language='zh', device='cpu', model_path='m', segments=[{'text': '甲', 'sourceStart': 1, 'sourceEnd': 2}, {'text': '甲', 'sourceStart': 10, 'sourceEnd': 11}])
        self.assertEqual(4, len(calls))
        self.assertTrue(all((c <= 8 for c in calls)))
        self.assertEqual('local-realigned', r['segments'][1]['chars'][0]['timingOrigin'])
        self.assertEqual(r['segments'][1]['rawChars'][0]['start'], r['segments'][1]['rawChars'][0]['end'])
        self.assertGreater(r['segments'][1]['chars'][0]['start'], 9)
        fake.load_align_model.assert_called_once()

class SafetyTest(unittest.TestCase):

    def test_silent_candidate_is_not_resurrected_from_voiced_neighbors(self):
        audio = np.ones(3 * 16000)
        audio[16000:19200] = 0
        chars = [{'char': '甲', 'start': 0.5, 'end': 0.9}, {'char': '乙', 'start': 1.0, 'end': 1.2}, {'char': '丙', 'start': 1.5, 'end': 1.8}]
        validate_audio_evidence(chars, audio)
        r = normalize_alignment(units('甲乙丙'), [{'word': '甲乙丙', 'start': 0.5, 'end': 1.8}], chars, audio=audio)
        self.assertIn('1', r['unalignedTranscriptUnitIds'])

    def test_anchor_inference_does_not_cross_punctuation(self):
        text_units = [{'id': 'a', 'text': '甲', 'kind': 'speech'}, {'id': 'p', 'text': '。', 'kind': 'punctuation'}, {'id': 'b', 'text': '乙', 'kind': 'speech'}, {'id': 'c', 'text': '丙', 'kind': 'speech'}]
        r = normalize_alignment(text_units, [], [{'char': '甲', 'start': 0.5, 'end': 0.9}, {'char': '乙'}, {'char': '丙', 'start': 1.5, 'end': 1.8}], audio=np.ones(3 * 16000))
        self.assertIn('b', r['unalignedTranscriptUnitIds'])

    def test_raw_out_of_range_score_remains_diagnostic(self):
        chars = [{'char': '甲', 'start': 0.1, 'end': 0.2, 'score': 1.5}]
        validate_audio_evidence(chars, np.ones(16000))
        r = normalize_alignment(units('甲'), [], chars, audio=np.ones(16000))
        self.assertEqual(1.5, r['observations'][0]['confidence'])
        self.assertEqual([], r['units'])

    def test_retry_cannot_overwrite_a_good_right_anchor(self):
        from redencut_speech_worker.alignment_recovery import retry_local_alignment
        chars = [{'char': '甲', 'start': 0.1, 'end': 0.2}, {'char': '乙', 'start': 0.2, 'end': 0.2}, {'char': '丙', 'start': 0.8, 'end': 1.0}]
        validate_audio_evidence(chars, np.ones(2 * 16000))
        r = retry_local_alignment(chars, np.ones(2 * 16000), lambda text, audio: {'segments': [{'chars': [{'char': '甲', 'start': 0.1, 'end': 0.2}, {'char': '乙', 'start': 0.3, 'end': 0.9}, {'char': '丙', 'start': 0.9, 'end': 1.0}]}]})
        self.assertEqual(0.2, r[1]['end'])
        self.assertEqual(0.8, r[2]['start'])

    def test_retry_failure_leaves_original_evidence_usable(self):
        from redencut_speech_worker.alignment_recovery import retry_local_alignment
        chars = [{'char': '甲', 'start': 0.1, 'end': 0.1}]
        validate_audio_evidence(chars, np.ones(16000))

        def fail(text, audio):
            raise RuntimeError('local inference failed')
        self.assertEqual(chars, retry_local_alignment(chars, np.ones(16000), fail))

class AdapterRecoveryTest(unittest.TestCase):

    def test_adapter_retains_raw_and_uses_short_context_after_consumed_words(self):
        from unittest.mock import patch
        from redencut_speech_worker.alignment import align
        segment = {'text': '甲乙', 'chars': [{'char': '甲', 'start': 0.1, 'end': 0.2}, {'char': '乙'}], 'words': [{'word': '甲', 'start': 0.1, 'end': 0.2}], 'audio': np.ones(16000), 'audioOffset': 0, 'contextStart': 0, 'contextEnd': 1}
        request = {'audioPath': 'a', 'language': 'zh', 'transcriptUnits': units('甲乙'), 'models': {'alignment': 'm'}, 'config': {'device': 'cpu'}}
        model = {'snapshot': 'm', 'repository': 'r', 'revision': 'v'}
        with patch('redencut_speech_worker.alignment.run_whisperx_alignment', return_value={'segments': [segment]}), patch('redencut_speech_worker.alignment.load_manifest_model', return_value=model):
            result = align(request)
            segment['contextEnd'] = 3
            segment['audio'] = np.ones(3 * 16000)
            long_result = align(request)
        self.assertEqual('missing-timing', result['observations'][1]['reason'])
        self.assertEqual('group-fallback', result['units'][1]['timingOrigin'])
        self.assertEqual((0.2, 1), (result['units'][1]['sourceStart'], result['units'][1]['sourceEnd']))
        self.assertEqual('1', result['recoveryProvenance']['algorithmVersion'])
        self.assertEqual(['1'], long_result['unalignedTranscriptUnitIds'])

    def test_public_normalizer_classifies_raw_invalid_score(self):
        for score in [0, -1, 1.5]:
            with self.subTest(score=score):
                chars = [{'char': '甲', 'start': 0.1, 'end': 0.2, 'score': score}]
                result = normalize_alignment(units('甲'), [], chars, audio=np.ones(16000))
                self.assertEqual([], result['units'])
                self.assertEqual(score, result['observations'][0]['confidence'])
                self.assertEqual('low-score', result['observations'][0]['reason'])

class EndOfAudioTest(unittest.TestCase):
    def test_recognition_tail_search_intersects_audio(self):
        from redencut_speech_worker.alignment_segments import prepare_segments
        result = prepare_segments('你沒想到?', [{'text': '你沒想到?', 'sourceStart': 29.87, 'sourceEnd': 30.87}], 30)
        self.assertEqual(30, result[0]['end'])
        self.assertGreaterEqual(result[0]['start'], 29)

    def test_entirely_outside_audio_has_no_search(self):
        from redencut_speech_worker.alignment_segments import prepare_segments
        result = prepare_segments('尾声', [{'text': '尾声', 'sourceStart': 30.87, 'sourceEnd': 31.2}], 30)
        self.assertEqual((30, 30), (result[0]['start'], result[0]['end']))

    def test_outside_audio_still_rejects_unbounded_recognition_span(self):
        from redencut_speech_worker.alignment_segments import prepare_segments
        with self.assertRaisesRegex(ValueError, '30'):
            prepare_segments('尾声', [{'text': '尾声', 'sourceStart': 29, 'sourceEnd': 61}], 30)
