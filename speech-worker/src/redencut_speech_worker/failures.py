"""Stable, safe alignment failure codes for the JSONL process boundary."""
from enum import StrEnum


class WorkerFailureCode(StrEnum):
    ALIGNMENT_SEGMENT_MISMATCH = "alignment-segment-mismatch"
    ALIGNMENT_TIMING_INVALID = "alignment-timing-invalid"
    ALIGNMENT_WINDOW_TOO_LONG = "alignment-window-too-long"
    ALIGNMENT_MODEL_UNAVAILABLE = "alignment-model-unavailable"
    ALIGNMENT_INFERENCE_FAILED = "alignment-inference-failed"
    INVALID_REQUEST = "invalid-request"
    WORKER_FAILED = "worker-failed"


class AlignmentFailure(ValueError):
    def __init__(self, code: WorkerFailureCode, message: str, **details: int | float):
        super().__init__(message)
        self.code = code
        self.details = details
