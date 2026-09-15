"""Classify acoustic evidence without discarding the aligner's observations."""
import math
import numpy as np


def validate_audio_evidence(items, audio, sample_rate=16000):
    for item in items:
        start, end = item.get('start'), item.get('end')
        item['audioEvidence'] = 'unknown'
        item.pop('audioEvidenceRejected', None)
        if start is None or end is None:
            reason = 'missing-timing'
        elif not (math.isfinite(start) and math.isfinite(end) and 0 <= start < end <= len(audio)/sample_rate):
            reason = 'invalid-bounds'
        else:
            samples = audio[math.floor(start*sample_rate):math.ceil(end*sample_rate)]
            if not samples.size or not np.isfinite(samples).all():
                reason = 'invalid-bounds'
            elif not np.any(samples != 0):
                item['audioEvidence'] = 'silence'
                reason = 'silence'
            else:
                item['audioEvidence'] = 'non-silent'
                score = item.get('score')
                reason = 'low-score' if score is not None and (not math.isfinite(score) or score < .1 or score > 1) else 'accepted'
        item['reason'] = reason
        score = item.get('score')
        if reason not in ('accepted','low-score') or (score is not None and not (math.isfinite(score) and 0 < score <= 1)):
            item['audioEvidenceRejected'] = True
