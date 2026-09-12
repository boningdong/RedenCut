from typing import Any, Dict


class ProtocolError(ValueError):
    pass


def parse_request(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ProtocolError("request must be an object")
    expected = {
        "protocolVersion", "jobId", "audioPath", "language",
        "transcriptUnits", "models", "config",
    }
    if set(value) != expected:
        raise ProtocolError("request contains missing or unknown fields")
    if value["protocolVersion"] != 1:
        raise ProtocolError("unsupported protocol version")
    if not all(isinstance(value[key], str) and value[key] for key in ("jobId", "audioPath", "language")):
        raise ProtocolError("jobId, audioPath, and language are required strings")
    if not isinstance(value["transcriptUnits"], list):
        raise ProtocolError("transcriptUnits must be an array")
    for unit in value["transcriptUnits"]:
        if not isinstance(unit, dict) or set(unit) != {"id", "text", "kind"}:
            raise ProtocolError("invalid transcript unit")
        if unit["kind"] not in ("speech", "punctuation"):
            raise ProtocolError("invalid transcript unit kind")
    if not isinstance(value["models"], dict) or set(value["models"]) != {"alignment", "diarization"}:
        raise ProtocolError("invalid model selection")
    if not isinstance(value["config"], dict) or set(value["config"]) != {"device"}:
        raise ProtocolError("invalid worker config")
    if value["config"]["device"] not in ("cpu", "cuda", "mps"):
        raise ProtocolError("unsupported device")
    return value
