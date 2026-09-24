"""Stable, safe alignment failure codes for the JSONL process boundary."""

class AlignmentFailure(ValueError):
    def __init__(self, code: str, message: str, **details: int | float):
        super().__init__(message)
        self.code = code
        self.details = details
