"""Resolve text timings from preserved observations and bounded acoustic context."""
import math

from .alignment_quality import validate_audio_evidence

MAX_ANCHOR_GAP = 2.0
MAX_FALLBACK_DURATION = 8.0
MAX_RETRIES_PER_WINDOW = 1
MAX_UTTERANCE_FALLBACK_DURATION = 2.0


def normalized(text):
    return ''.join(character.lower() for character in text if character.isalnum())


def supported(start, end, audio, offset, limit):
    if start is None or end is None or not (
        math.isfinite(start) and math.isfinite(end) and 0 < end - start <= limit
    ):
        return False
    if audio is None:
        return False
    item = {'start': start - offset, 'end': end - offset}
    validate_audio_evidence([item], audio)
    if item.get('audioEvidenceRejected'):
        return False
    # A voiced edge cannot justify bridging a long digital-silence region.
    samples = audio[int((start - offset) * 16000):int((end - offset) * 16000)]
    longest = run = 0
    for block in range(0, len(samples), 1600):
        run = run + 1 if not samples[block:block + 1600].any() else 0
        longest = max(longest, run)
    return longest < 5


def observation_for(unit_id, matched, previous_end, audio, offset):
    classified = []
    for original in matched:
        char = dict(original)
        if audio is not None:
            evidence = dict(char)
            for key in ('start', 'end'):
                if evidence.get(key) is not None:
                    evidence[key] -= offset
            validate_audio_evidence([evidence], audio)
            for key in ('reason', 'audioEvidence', 'audioEvidenceRejected'):
                if key in evidence:
                    char[key] = evidence[key]
        score = char.get('score')
        if score is not None and not (math.isfinite(score) and 0 < score <= 1):
            char['audioEvidenceRejected'] = True
            if char.get('reason') not in ('silence', 'invalid-bounds', 'missing-timing'):
                char['reason'] = 'low-score'
        classified.append(char)
    matched = classified
    start = matched[0].get('start') if matched else None
    end = matched[-1].get('end') if matched else None
    valid = bool(matched) and all(
        char.get('start') is not None and char.get('end') is not None
        and math.isfinite(char['start']) and math.isfinite(char['end'])
        and char['start'] < char['end'] and not char.get('audioEvidenceRejected')
        for char in matched
    )
    valid = valid and all(left['end'] <= right['start'] for left, right in zip(matched, matched[1:]))
    reason = next((char.get('reason') for char in matched if char.get('audioEvidenceRejected')), None)
    reason = reason or ('accepted' if valid else 'invalid-bounds' if start is not None else 'missing-timing')
    evidence = next((char.get('audioEvidence') for char in matched if char.get('audioEvidence')), 'unknown')
    if valid and start < previous_end:
        valid, reason = False, 'conflict'
    if valid and audio is not None:
        item = {'start': start - offset, 'end': end - offset}
        validate_audio_evidence([item], audio)
        evidence = item['audioEvidence']
        if item.get('audioEvidenceRejected'):
            valid, reason = False, item['reason']
    scores = [char['score'] for char in matched if char.get('score') is not None and math.isfinite(char['score'])]
    if valid and scores and min(scores) < .1:
        reason = 'low-score'
    observation = {'transcriptUnitIds': [unit_id], 'audioEvidence': evidence, 'reason': reason}
    for key, value in [('candidateStart', start), ('candidateEnd', end)]:
        if value is not None and math.isfinite(value):
            observation[key] = value
    if scores:
        observation['confidence'] = min(scores)
    return observation, valid


def missing_runs(count, resolved):
    index = 0
    while index < count:
        if index in resolved:
            index += 1
            continue
        first = index
        while index < count and index not in resolved:
            index += 1
        yield first, index


def assign_group(resolved, speech, first, last, start, end, origin, anchors=()):
    group = {
        'transcriptUnitIds': [unit['id'] for unit in speech[first:last]],
        'sourceStart': start, 'sourceEnd': end,
        'granularity': 'character' if last - first == 1 and len(normalized(speech[first]['text'])) == 1 else 'phrase',
        'timingOrigin': origin,
    }
    if anchors:
        group['evidenceAnchorTextUnitIds'] = list(anchors)
    for index in range(first, last):
        resolved[index] = group


def resolve_alignment(transcript_units, words, chars, audio=None, audio_offset=0):
    speech = [unit for unit in transcript_units if unit['kind'] == 'speech']
    positions = {unit['id']: index for index, unit in enumerate(transcript_units)}
    boundaries = {index for index in range(1, len(speech))
                  if positions[speech[index]['id']] != positions[speech[index - 1]['id']] + 1}
    observations, resolved = [], {}
    cursor, previous_end = 0, -math.inf
    for index, unit in enumerate(speech):
        target, accumulated, matched = normalized(unit['text']), '', []
        next_cursor = cursor
        while next_cursor < len(chars) and len(accumulated) < len(target):
            char = chars[next_cursor]
            next_cursor += 1
            value = normalized(str(char.get('char', '')))
            if value:
                accumulated += value
                matched.append(char)
        if accumulated != target or not matched:
            matched = []
        else:
            cursor = next_cursor
        observation, valid = observation_for(unit['id'], matched, previous_end, audio, audio_offset)
        observations.append(observation)
        if valid:
            timing = {
                'transcriptUnitIds': [unit['id']],
                'sourceStart': observation['candidateStart'], 'sourceEnd': observation['candidateEnd'],
                'granularity': 'character' if len(target) == 1 else 'word',
                'timingOrigin': 'local-realigned' if any(char.get('timingOrigin') == 'local-realigned' for char in matched) else 'aligned',
            }
            confidence = observation.get('confidence')
            if confidence is not None and 0 <= confidence <= 1:
                timing['confidence'] = confidence
            resolved[index] = timing
            previous_end = timing['sourceEnd']

    for first, last in list(missing_runs(len(speech), resolved)):
        left, right = resolved.get(first - 1), resolved.get(last)
        blocked = any(observation['reason'] == 'silence' for observation in observations[first:last])
        crosses_boundary = any(first <= boundary <= last for boundary in boundaries)
        if not blocked and not crosses_boundary and left and right and supported(left['sourceEnd'], right['sourceStart'], audio, audio_offset, MAX_ANCHOR_GAP):
            assign_group(resolved, speech, first, last, left['sourceEnd'], right['sourceStart'],
                         'anchor-inferred' if last - first == 1 else 'group-fallback',
                         left['transcriptUnitIds'] + right['transcriptUnitIds'])

    cursor = 0
    for word in words:
        target, accumulated, indices = normalized(str(word.get('word', ''))), '', []
        # Context candidates are independent of the word token stream.
        if word.get('contextCandidate'):
            cursor = 0
            if word.get('start') is None or word.get('end') is None or word['end'] - word['start'] > MAX_UTTERANCE_FALLBACK_DURATION:
                continue
        while cursor + len(indices) < len(speech) and len(accumulated) < len(target):
            index = cursor + len(indices)
            indices.append(index)
            accumulated += normalized(speech[index]['text'])
        if not target or accumulated != target:
            continue
        cursor += len(indices)
        if word.get('audioEvidenceRejected') or any(indices[0] < boundary <= indices[-1] for boundary in boundaries):
            continue
        for first, last in list(missing_runs(len(speech), resolved)):
            if any(observation['reason'] == 'silence' for observation in observations[first:last]):
                continue
            if first < indices[0] or last - 1 > indices[-1]:
                continue
            start, end = word.get('start'), word.get('end')
            left, right = resolved.get(first - 1), resolved.get(last)
            if start is None or end is None:
                continue
            if left:
                start = max(start, left['sourceEnd'])
            if right:
                end = min(end, right['sourceStart'])
            if supported(start, end, audio, audio_offset, MAX_FALLBACK_DURATION):
                anchors = (left['transcriptUnitIds'] if left else []) + (right['transcriptUnitIds'] if right else [])
                assign_group(resolved, speech, first, last, start, end, 'group-fallback', anchors)

    output, emitted = [], set()
    for index in sorted(resolved):
        timing = resolved[index]
        key = tuple(timing['transcriptUnitIds'])
        if key not in emitted:
            output.append(timing)
            emitted.add(key)
    return {
        'units': output,
        'unalignedTranscriptUnitIds': [unit['id'] for index, unit in enumerate(speech) if index not in resolved],
        'observations': observations, 'recoveryVersion': 1,
    }


def retry_local_alignment(chars, audio, infer):
    """One bounded retry per source window, using the already loaded model."""
    failed = [index for index, char in enumerate(chars)
              if normalized(str(char.get('char', ''))) and char.get('audioEvidenceRejected') and char.get('reason') != 'silence']
    if not failed:
        return chars
    first, last = failed[0], failed[0] + 1
    while last < len(chars) and chars[last].get('audioEvidenceRejected'):
        last += 1
    # Include neighboring known text for phonetic context.
    lo, hi = max(0, first - 1), min(len(chars), last + 1)
    start, end = chars[lo].get('start', 0), chars[hi - 1].get('end', len(audio) / 16000)
    if start is None or not math.isfinite(start):
        start = 0
    if end is None or not math.isfinite(end):
        end = len(audio) / 16000
    start, end = max(0, start - .25), min(len(audio) / 16000, end + .25)
    if not supported(start, end, audio, 0, MAX_FALLBACK_DURATION):
        return chars
    offset = int(start * 16000) / 16000
    clip = audio[int(start * 16000):int(end * 16000)]
    text = ''.join(char.get('char', '') for char in chars[lo:hi])
    try:
        result = infer(text, clip)
    except Exception:
        # This optional refinement cannot discard successful first-pass work.
        return chars
    retry = [dict(char) for segment in result.get('segments', []) for char in segment.get('chars', [])
             if normalized(str(char.get('char', '')))]
    original = [index for index in range(lo, hi) if normalized(str(chars[index].get('char', '')))]
    if [normalized(str(char.get('char', ''))) for char in retry] != [normalized(str(chars[index].get('char', ''))) for index in original]:
        return chars
    validate_audio_evidence(retry, clip)
    output = [dict(char) for char in chars]
    for index, char in zip(original, retry):
        left = next((candidate for candidate in reversed(output[:index])
                     if not candidate.get('audioEvidenceRejected') and candidate.get('end') is not None), None)
        right = next((candidate for candidate in chars[index + 1:]
                      if not candidate.get('audioEvidenceRejected') and candidate.get('start') is not None), None)
        fits = (not char.get('audioEvidenceRejected')
                and (left is None or char['start'] + offset >= left['end'])
                and (right is None or char['end'] + offset <= right['start']))
        if chars[index].get('audioEvidenceRejected') and chars[index].get('reason') != 'silence' and fits:
            output[index] = {**char, 'start': char['start'] + offset, 'end': char['end'] + offset, 'timingOrigin': 'local-realigned'}
    return output
