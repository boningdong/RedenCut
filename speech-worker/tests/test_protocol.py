import io
import json
import unittest
from unittest.mock import patch

from redencut_speech_worker.__main__ import run
from redencut_speech_worker.protocol import ProtocolError, parse_request
from redencut_speech_worker.failures import AlignmentFailure


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
    def test_alignment_failure_jsonl_uses_safe_code_and_details(self):
        output = io.StringIO()
        with patch("redencut_speech_worker.__main__.align", side_effect=AlignmentFailure(
            "alignment-segment-mismatch", "/private/audio.wav token=secret")):
            self.assertEqual(2, run(io.StringIO(json.dumps(request())), output))
        terminal = json.loads(output.getvalue().splitlines()[-1])
        self.assertEqual("alignment-segment-mismatch", terminal["code"])
        self.assertNotIn("/private", json.dumps(terminal))
        self.assertNotIn("token=", json.dumps(terminal))
    def test_accepts_segment_timing_and_rejects_invalid_ranges(self):
        candidate = request()
        candidate["alignmentSegments"] = [{"text": "hello", "sourceStart": 1, "sourceEnd": 2}]
        self.assertEqual(candidate, parse_request(candidate))
        for start, end in [(2, 1), (-1, 2), (0, float("inf")), (True, 2)]:
            candidate["alignmentSegments"][0].update(sourceStart=start, sourceEnd=end)
            with self.assertRaises(ProtocolError):
                parse_request(candidate)

    def test_alignment_progress_and_library_output_keep_jsonl_clean(self):
        output = io.StringIO()
        def alignment(request, on_progress):
            print("library diagnostic")
            on_progress(50)
            return {"units": [], "unalignedTranscriptUnitIds": [], "provenance": {}}
        with patch("redencut_speech_worker.__main__.align", side_effect=alignment), patch(
            "redencut_speech_worker.__main__.diarize", return_value={"turns": [], "provenance": {}}):
            self.assertEqual(0, run(io.StringIO(json.dumps(request())), output))
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertIn(50, [m.get("percent") for m in messages])

    def test_rejects_unknown_versions_and_secret_fields(self):
        candidate = request()
        candidate["protocolVersion"] = 2
        with self.assertRaises(ProtocolError):
            parse_request(candidate)
        candidate = request()
        candidate["hfToken"] = "secret"
        with self.assertRaises(ProtocolError):
            parse_request(candidate)

    @patch("redencut_speech_worker.__main__.diarize", return_value={"turns": [], "provenance": {}})
    @patch("redencut_speech_worker.__main__.align", return_value={"units": [], "unalignedTranscriptUnitIds": [], "provenance": {}})
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

    @patch("redencut_speech_worker.__main__.diarize", return_value={"turns": [], "provenance": {}})
    @patch("redencut_speech_worker.__main__.align", return_value={"units": [], "unalignedTranscriptUnitIds": [], "provenance": {}})
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

class PhaseTest(unittest.TestCase):
    def test_diarization_only_never_aligns_or_invents_percent(self):
        candidate = request()
        candidate.update(phase="diarization")
        candidate.pop("transcriptUnits")
        candidate.pop("language")
        candidate["models"].pop("alignment")
        output = io.StringIO()
        with patch("redencut_speech_worker.__main__.align") as alignment, patch("redencut_speech_worker.__main__.diarize", return_value={"turns": [], "provenance": {}}):
            self.assertEqual(0, run(io.StringIO(json.dumps(candidate)), output))
            alignment.assert_not_called()
        messages = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertNotIn("alignment", messages[-1]["result"])
        self.assertTrue(all("percent" not in m for m in messages))

    def test_alignment_only_does_not_diarize(self):
        candidate = request()
        candidate["phase"] = "alignment"
        candidate["models"].pop("diarization")
        output = io.StringIO()
        with patch("redencut_speech_worker.__main__.align", return_value={"units": [], "unalignedTranscriptUnitIds": [], "provenance": {}}), patch("redencut_speech_worker.__main__.diarize") as diarization:
            self.assertEqual(0, run(io.StringIO(json.dumps(candidate)), output))
            diarization.assert_not_called()
        self.assertNotIn("diarization", json.loads(output.getvalue().splitlines()[-1])["result"])
