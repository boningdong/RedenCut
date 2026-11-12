"""Load bundled sentence tables without downloads or user-cache fallback."""
import os
import json
from pathlib import Path
from .failures import AlignmentFailure, WorkerFailureCode

RESOURCE_MESSAGE = "Alignment runtime data is missing or invalid. Repair or reinstall the application runtime, then retry."

def require_alignment_resources():
    try:
        import nltk
        root = os.environ.get("NLTK_DATA")
        if not root or not Path(root).is_dir():
            raise LookupError("Bundled NLTK_DATA directory is unavailable")
        # Both supported alignment languages use WhisperX's English Punkt tables.
        nltk.data.path[:] = [str(Path(root).resolve())]
        return nltk.data.load("tokenizers/punkt_tab/english.pickle", cache=False)
    except (ImportError, LookupError, OSError, ValueError) as error:
        raise AlignmentFailure(WorkerFailureCode.ALIGNMENT_RESOURCES_UNAVAILABLE, RESOURCE_MESSAGE) from error

def main():
    try:
        require_alignment_resources()
    except AlignmentFailure as error:
        if error.code != WorkerFailureCode.ALIGNMENT_RESOURCES_UNAVAILABLE:
            raise
        result = {"status": "unavailable", "code": error.code}
    else:
        result = {"status": "ready"}
    print(json.dumps(result))

if __name__ == "__main__":
    main()
