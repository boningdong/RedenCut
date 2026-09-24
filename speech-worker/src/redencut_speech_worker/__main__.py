from contextlib import redirect_stdout
import json
import sys
from typing import IO, Any, Dict

from .alignment import align
from .diarization import diarize
from .protocol import ProtocolError, parse_request
from .failures import AlignmentFailure

MAX_JSONL_MESSAGE_BYTES = 32 * 1024 * 1024


def emit(output: IO[str], value: Dict[str, Any]) -> None:
    output.write(json.dumps(value, separators=(",", ":"), sort_keys=True) + "\n")
    output.flush()


def run(input_stream: IO[str], output: IO[str]) -> int:
    job_id = "unknown"
    try:
        line = input_stream.readline(MAX_JSONL_MESSAGE_BYTES + 1)
        if not line or len(line.encode("utf-8")) > MAX_JSONL_MESSAGE_BYTES:
            raise ProtocolError("request line is missing or too large")
        request = parse_request(json.loads(line))
        job_id = request["jobId"]
        envelope = {"protocolVersion": 1, "jobId": job_id}
        emit(output, {**envelope, "type": "ready"})
        phase = request.get("phase")
        result = {"phase": phase} if phase else {}
        # Third-party libraries may print; stdout is reserved for our JSONL protocol.
        if phase != "diarization":
            emit(output, {**envelope, "type": "progress", "stage": "aligning"})
            with redirect_stdout(sys.stderr):
                result["alignment"] = align(request, on_progress=lambda percent: emit(output, {
                    **envelope, "type": "progress", "stage": "aligning", "percent": percent,
                }))
        if phase != "alignment":
            if phase == "diarization" or request["config"].get("speakerRecognitionEnabled", True):
                emit(output, {**envelope, "type": "progress", "stage": "diarizing"})
                with redirect_stdout(sys.stderr):
                    result["diarization"] = {"status": "completed", **diarize(request, on_progress=lambda: emit(output, {
                        **envelope, "type": "progress", "stage": "diarizing",
                    }))}
            else:
                result["diarization"] = {"status": "skipped-disabled"}
        emit(output, {**envelope, "type": "result", "result": result})
        return 0
    except Exception as error:
        code = (error.code if isinstance(error, AlignmentFailure) else
                "invalid-request" if isinstance(error, (ProtocolError, json.JSONDecodeError)) else "worker-failed")
        emit(output, {
            "protocolVersion": 1, "jobId": job_id, "type": "error",
            "code": code,
            "message": "The speech worker could not complete this request.",
            **({"details": error.details} if isinstance(error, AlignmentFailure) else {}),
        })
        return 2


if __name__ == "__main__":
    sys.exit(run(sys.stdin, sys.stdout))
