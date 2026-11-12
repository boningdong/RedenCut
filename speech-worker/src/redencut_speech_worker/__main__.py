from contextlib import redirect_stdout
import json
import logging
import sys
from typing import IO, Any, Callable, Dict, Optional

from .logging_setup import configure_logging
from .alignment import align
from .diarization import diarize
from .protocol import ProtocolError, parse_request
from .failures import AlignmentFailure, WorkerFailureCode
from .nltk_resources import RESOURCE_MESSAGE

MAX_JSONL_MESSAGE_BYTES = 32 * 1024 * 1024
ProgressReporter = Callable[[str, Optional[float]], None]


def emit(output: IO[str], value: Dict[str, Any]) -> None:
    output.write(json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n")
    output.flush()


def read_request(input_stream: IO[str]) -> Dict[str, Any]:
    line = input_stream.readline(MAX_JSONL_MESSAGE_BYTES + 1)
    if not line or len(line.encode("utf-8")) > MAX_JSONL_MESSAGE_BYTES:
        raise ProtocolError("request line is missing or too large")
    return parse_request(json.loads(line))


def execute_request(request: Dict[str, Any], report_progress: ProgressReporter) -> Dict[str, Any]:
    phase = request.get("phase")
    result = {"phase": phase} if phase else {}

    if phase != "diarization":
        report_progress("aligning", None)
        result["alignment"] = align(
            request,
            on_progress=lambda percent: report_progress("aligning", percent),
        )

    if phase != "alignment":
        if phase == "diarization" or request["config"].get("speakerRecognitionEnabled", True):
            report_progress("diarizing", None)
            result["diarization"] = {
                "status": "completed",
                **diarize(request, on_progress=lambda: report_progress("diarizing", None)),
            }
        else:
            result["diarization"] = {"status": "skipped-disabled"}

    return result


def emit_progress(output: IO[str], envelope: Dict[str, Any], stage: str, percent: Optional[float]) -> None:
    message = {**envelope, "type": "progress", "stage": stage}
    if percent is not None:
        message["percent"] = percent
    emit(output, message)


def describe_failure(error: Exception) -> Dict[str, Any]:
    message = "The speech worker could not complete this request."
    if isinstance(error, AlignmentFailure):
        if error.code == WorkerFailureCode.ALIGNMENT_RESOURCES_UNAVAILABLE:
            message = RESOURCE_MESSAGE
        return {"code": error.code, "message": message, "details": error.details}

    if isinstance(error, (ProtocolError, json.JSONDecodeError)):
        return {"code": WorkerFailureCode.INVALID_REQUEST, "message": message}

    return {"code": WorkerFailureCode.WORKER_FAILED, "message": message}


def run(input_stream: IO[str], output: IO[str]) -> int:
    configure_logging()
    envelope = {"protocolVersion": 1, "jobId": "unknown"}
    try:
        request = read_request(input_stream)
        envelope["jobId"] = request["jobId"]
        emit(output, {**envelope, "type": "ready"})
        # Third-party libraries may print; stdout is reserved for our JSONL protocol.
        with redirect_stdout(sys.stderr):
            result = execute_request(
                request,
                lambda stage, percent: emit_progress(output, envelope, stage, percent),
            )
        emit(output, {**envelope, "type": "result", "result": result})
        return 0
    except Exception as error:
        logging.getLogger("speech-worker").exception("Speech worker request failed")
        emit(output, {**envelope, "type": "error", **describe_failure(error)})
        return 2


if __name__ == "__main__":
    sys.exit(run(sys.stdin, sys.stdout))
