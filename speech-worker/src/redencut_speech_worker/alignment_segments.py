"""Bound acoustic searches using recognition evidence without inventing edit times."""
import math
import unicodedata
from typing import Any, Dict, List, Optional
from .failures import AlignmentFailure, WorkerFailureCode

MAX_SEGMENT_SECONDS = 30.0
CONTEXT_SECONDS = 0.25


def compact(text: str) -> str:
    return "".join(unicodedata.normalize("NFC", text).split())


def prepare_segments(text: str, segments: Optional[List[Dict[str, Any]]], duration: float) -> List[Dict[str, Any]]:
    if not segments:
        segments = [{"text": text}]
    if compact("".join(segment["text"] for segment in segments)) != compact(text):
        raise AlignmentFailure(WorkerFailureCode.ALIGNMENT_SEGMENT_MISMATCH, "Alignment segment text does not match the transcript")
    output = []
    previous_end = 0.0
    for segment in segments:
        if not compact(segment["text"]):
            continue
        start, end = segment.get("sourceStart"), segment.get("sourceEnd")
        if start is None or end is None:
            if len(segments) != 1 or duration > MAX_SEGMENT_SECONDS:
                raise AlignmentFailure(WorkerFailureCode.ALIGNMENT_WINDOW_TOO_LONG, "Long audio alignment requires segment timing from transcription", durationSeconds=duration)
            start, end = 0.0, duration
        if (not all(type(value) in (int, float) and math.isfinite(value) for value in (start, end))
                or start < 0 or end < start or start < previous_end):
            raise AlignmentFailure(WorkerFailureCode.ALIGNMENT_TIMING_INVALID, "Alignment segment timing must be finite, ordered and non-overlapping")
        if end - start > MAX_SEGMENT_SECONDS:
            raise AlignmentFailure(WorkerFailureCode.ALIGNMENT_WINDOW_TOO_LONG, "Alignment search exceeds 30 seconds; finer transcription timing is required", durationSeconds=end-start)
        # Recognition may describe a truncated final utterance beyond EOF. Its
        # search context can only intersect existing samples, never invent them.
        padding = min(CONTEXT_SECONDS, (MAX_SEGMENT_SECONDS - (end - start)) / 2)
        if start >= duration:
            search_start = search_end = duration
        elif start == end:
            search_start = search_end = start
        else:
            search_start, search_end = max(0.0, start - padding), min(duration, end + padding)
        output.append({"text": segment["text"], "start": search_start, "end": search_end})
        previous_end = end
    return output


def partition_units(units: List[Dict[str, Any]], texts: List[str]) -> List[List[Dict[str, Any]]]:
    """Keep repeated words and unmatched characters local to their recognition segment."""
    groups = []
    cursor = 0
    for text in texts:
        target = compact(text)
        group, accumulated = [], ""
        while cursor < len(units) and len(accumulated) < len(target):
            group.append(units[cursor])
            accumulated += compact(units[cursor]["text"])
            cursor += 1
        if accumulated != target:
            raise AlignmentFailure(WorkerFailureCode.ALIGNMENT_SEGMENT_MISMATCH, "Alignment segment text does not match canonical transcript units")
        groups.append(group)
    if cursor != len(units):
        raise AlignmentFailure(WorkerFailureCode.ALIGNMENT_SEGMENT_MISMATCH, "Alignment segments do not cover the canonical transcript")
    return groups
