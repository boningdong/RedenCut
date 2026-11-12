import os
import io
import json
from contextlib import redirect_stdout
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import nltk
from redencut_speech_worker.failures import AlignmentFailure
from redencut_speech_worker.nltk_resources import require_alignment_resources
from redencut_speech_worker import nltk_resources

class NltkResourcesTest(unittest.TestCase):
    def tearDown(self):
        nltk.data.clear_cache()

    def test_missing_bundle_is_typed_even_when_user_cache_exists(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.dict(os.environ, {"NLTK_DATA": root}), patch.object(nltk.data, "path", ["/user/cache"]):
                with self.assertRaises(AlignmentFailure) as failure:
                    require_alignment_resources()
                self.assertEqual("alignment-resources-unavailable", failure.exception.code)
                self.assertIn("runtime", str(failure.exception))

    def test_bundled_tables_load_without_download_or_user_cache(self):
        with tempfile.TemporaryDirectory() as root:
            tables = Path(root) / "tokenizers/punkt_tab/english"
            tables.mkdir(parents=True)
            for name in ("abbrev_types.txt", "collocations.tab", "ortho_context.tab", "sent_starters.txt"):
                (tables / name).write_text("")
            with patch.dict(os.environ, {"NLTK_DATA": root}), patch.object(nltk.data, "path", ["/user/cache"]), patch("nltk.download", side_effect=AssertionError("must not download")):
                splitter = require_alignment_resources()
                self.assertEqual(["Hello.", "Goodbye."], splitter.tokenize("Hello. Goodbye."))

    def test_probe_reports_missing_data_as_an_explicit_result(self):
        with tempfile.TemporaryDirectory() as root, patch.dict(os.environ, {"NLTK_DATA": root}):
            output = io.StringIO()
            with redirect_stdout(output):
                nltk_resources.main()
            self.assertEqual({"status": "unavailable", "code": "alignment-resources-unavailable"}, json.loads(output.getvalue()))

    def test_probe_reports_ready_when_tables_load(self):
        with tempfile.TemporaryDirectory() as root:
            tables = Path(root) / "tokenizers/punkt_tab/english"
            tables.mkdir(parents=True)
            for name in ("abbrev_types.txt", "collocations.tab", "ortho_context.tab", "sent_starters.txt"):
                (tables / name).write_text("")
            output = io.StringIO()
            with patch.dict(os.environ, {"NLTK_DATA": root}), redirect_stdout(output):
                nltk_resources.main()
            self.assertEqual({"status": "ready"}, json.loads(output.getvalue()))

    def test_probe_does_not_relabel_an_unexpected_failure(self):
        with patch.object(nltk_resources, "require_alignment_resources", side_effect=RuntimeError("unexpected Python failure")):
            with self.assertRaisesRegex(RuntimeError, "unexpected Python failure"):
                nltk_resources.main()
