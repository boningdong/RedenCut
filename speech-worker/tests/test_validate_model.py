import unittest
from unittest.mock import patch
from pathlib import Path
from redencut_speech_worker.validate_model import validate_model

class ValidateModelTests(unittest.TestCase):
    def test_selects_alignment_language_and_requires_offline_load(self):
        with patch('redencut_speech_worker.validate_model.load_alignment') as load:
            validate_model({'capability': 'alignment', 'supportedLanguages': ['zh']}, Path('/managed/staging'))
            load.assert_called_once_with('zh', Path('/managed/staging'))

    def test_selects_real_diarization_loader(self):
        with patch('redencut_speech_worker.validate_model.load_diarization') as load:
            validate_model({'capability': 'diarization'}, Path('/managed/staging'))
            load.assert_called_once_with(Path('/managed/staging'))

    def test_load_failure_propagates(self):
        with patch('redencut_speech_worker.validate_model.load_alignment', side_effect=RuntimeError('corrupt')):
            with self.assertRaises(RuntimeError):
                validate_model({'capability': 'alignment', 'supportedLanguages': ['en']}, Path('/managed/staging'))

    def test_unknown_model_never_claims_validation(self):
        with self.assertRaises(ValueError):
            validate_model({'capability': 'unknown'}, Path('/managed/staging'))
