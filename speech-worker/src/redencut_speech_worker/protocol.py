from typing import Any, Dict
import math


class ProtocolError(ValueError):
    pass


def parse_request(value: Any) -> Dict[str, Any]:
    if not isinstance(value, dict):
        raise ProtocolError("request must be an object")
    expected = {
        "protocolVersion", "jobId", "audioPath", "language",
        "transcriptUnits", "models", "config",
    }
    phase = value.get("phase")
    if phase not in (None, "alignment", "diarization"):
        raise ProtocolError("unsupported phase")
    if phase == "diarization":
        expected -= {"language", "transcriptUnits"}
        if "alignmentSegments" in value:
            raise ProtocolError("diarization must omit alignment inputs")
    if set(value) - {"modelPaths", "alignmentSegments", "phase"} != expected:
        raise ProtocolError("request contains missing or unknown fields")
    if value["protocolVersion"] != 1:
        raise ProtocolError("unsupported protocol version")
    if not all(isinstance(value[key], str) and value[key] for key in (("jobId", "audioPath") if phase == "diarization" else ("jobId", "audioPath", "language"))):
        raise ProtocolError("jobId, audioPath, and language are required strings")
    if not isinstance(value.get("transcriptUnits", []), list):
        raise ProtocolError("transcriptUnits must be an array")
    for unit in value.get("transcriptUnits", []):
        if not isinstance(unit, dict) or set(unit) != {"id", "text", "kind"}:
            raise ProtocolError("invalid transcript unit")
        if unit["kind"] not in ("speech", "punctuation"):
            raise ProtocolError("invalid transcript unit kind")
    if "alignmentSegments" in value:
        if not isinstance(value["alignmentSegments"], list):
            raise ProtocolError("alignmentSegments must be an array")
        for segment in value["alignmentSegments"]:
            if (not isinstance(segment, dict) or "text" not in segment
                    or set(segment) - {"text", "sourceStart", "sourceEnd"}
                    or not isinstance(segment["text"], str)):
                raise ProtocolError("invalid alignment segment")
            for key in ("sourceStart", "sourceEnd"):
                if key in segment and (type(segment[key]) not in (int, float)
                        or not math.isfinite(segment[key]) or segment[key] < 0):
                    raise ProtocolError("invalid alignment segment timing")
            if ("sourceStart" in segment and "sourceEnd" in segment
                    and segment["sourceStart"] > segment["sourceEnd"]):
                raise ProtocolError("invalid alignment segment range")
    if not isinstance(value["models"], dict) or (set(value["models"]) - {"diarization"} != (set() if phase == "diarization" else {"alignment"})):
        raise ProtocolError("invalid model selection")
    if not isinstance(value["config"], dict) or (set(value["config"]) - {"speakerRecognitionEnabled"} != {"device"}):
        raise ProtocolError("invalid worker config")
    if value["config"]["device"] not in ("cpu", "cuda", "mps"):
        raise ProtocolError("unsupported device")
    enabled = value["config"].get("speakerRecognitionEnabled", True)
    if not isinstance(enabled, bool):
        raise ProtocolError("speakerRecognitionEnabled must be boolean")
    if phase != "alignment" and (enabled or phase == "diarization") and not value["models"].get("diarization"):
        raise ProtocolError("diarization model required when enabled")
    if "modelPaths" in value and (not isinstance(value["modelPaths"], dict) or not all(isinstance(k, str) and isinstance(v, str) and v for k, v in value["modelPaths"].items())):
        raise ProtocolError("invalid managed model paths")
    return value
