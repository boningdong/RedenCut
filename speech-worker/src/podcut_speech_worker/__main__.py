import json
import sys
from typing import IO, Any, Dict

from .alignment import align
from .diarization import diarize
from .protocol import ProtocolError, parse_request

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
        emit(output, {**envelope, "type": "progress", "stage": "aligning"})
        alignment = align(request)
        emit(output, {**envelope, "type": "progress", "stage": "diarizing"})
        diarization = diarize(request)
        emit(output, {**envelope, "type": "result", "result": {
            "alignment": alignment, "diarization": diarization,
        }})
        return 0
    except Exception as error:
        emit(output, {
            "protocolVersion": 1, "jobId": job_id, "type": "error",
            "code": "invalid-request" if isinstance(error, (ProtocolError, json.JSONDecodeError)) else "worker-failed",
            "message": str(error) or error.__class__.__name__,
        })
        return 2


if __name__ == "__main__":
    sys.exit(run(sys.stdin, sys.stdout))
