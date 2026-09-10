import io
import json
import unittest
from unittest.mock import patch

from podcut_speech_worker.__main__ import run
from podcut_speech_worker.protocol import ProtocolError, parse_request


def request():
    return {
        "protocolVersion": 1,
        "jobId": "job-1",
        "audioPath": "/tmp/source.wav",
        "language": "en",
        "transcriptUnits": [
            {"id": "550e8400-e29b-41d4-a716-446655440001", "text": "hello", "kind": "speech"}
        ],
        "models": {"alignment": "alignment-en", "diarization": "diarization-default"},
        "config": {"device": "cpu"},
    }


class ProtocolTest(unittest.TestCase):
    def test_rejects_unknown_versions_and_secret_fields(self):
        candidate = request()
        candidate["protocolVersion"] = 2
        with self.assertRaises(ProtocolError):
            parse_request(candidate)
        candidate = request()
        candidate["hfToken"] = "secret"
        with self.assertRaises(ProtocolError):
            parse_request(candidate)

    @patch("podcut_speech_worker.__main__.diarize", return_value={"turns": [], "provenance": {}})
    @patch("podcut_speech_worker.__main__.align", return_value={"units": [], "unalignedTranscriptUnitIds": [], "provenance": {}})
    def test_emits_one_correlated_result_and_machine_readable_progress(self, _align, _diarize):
        output = io.StringIO()
        code = run(io.StringIO(json.dumps(request()) + "\n"), output)
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(0, code)
        self.assertEqual(["ready", "progress", "progress", "result"], [m["type"] for m in messages])
        self.assertTrue(all(m["jobId"] == "job-1" for m in messages))

    def test_malformed_input_has_one_error_terminal(self):
        output = io.StringIO()
        code = run(io.StringIO("not-json\n"), output)
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertNotEqual(0, code)
        self.assertEqual(["error"], [m["type"] for m in messages])

    @patch("podcut_speech_worker.__main__.diarize", return_value={"turns": [], "provenance": {}})
    @patch("podcut_speech_worker.__main__.align", return_value={"units": [], "unalignedTranscriptUnitIds": [], "provenance": {}})
    def test_accepts_a_long_audio_request_above_the_legacy_one_mibibyte_limit(self, _align, _diarize):
        candidate = request()
        candidate["transcriptUnits"] = [
            {
                "id": f"00000000-0000-4000-8000-{index:012d}",
                "text": "说",
                "kind": "speech",
            }
            for index in range(15_000)
        ]
        encoded = json.dumps(candidate, ensure_ascii=False) + "\n"
        self.assertGreater(len(encoded.encode("utf-8")), 1_048_576)
        output = io.StringIO()

        code = run(io.StringIO(encoded), output)

        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(0, code)
        self.assertEqual("result", messages[-1]["type"])


if __name__ == "__main__":
    unittest.main()
