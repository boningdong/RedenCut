import io
import json
import logging
import unittest
import warnings
from redencut_speech_worker.logging_setup import configure_logging

class LoggingTests(unittest.TestCase):
    def test_levels_warnings_and_traceback_use_diagnostic_stream(self):
        output = io.StringIO()
        handler = configure_logging(output)
        logger = logging.getLogger('worker')
        try:
            logger.info('started')
            logger.debug('hidden')
            warnings.warn('compatibility warning', RuntimeWarning)
            try:
                raise ValueError('inference failed')
            except ValueError:
                logger.exception('worker failed')
            records = [json.loads(line) for line in output.getvalue().splitlines()]
            self.assertEqual([record['level'] for record in records], ['info', 'warn', 'error'])
            self.assertIn('ValueError: inference failed', records[-1]['stack'])
            self.assertNotIn('hidden', output.getvalue())
        finally:
            logging.getLogger().removeHandler(handler)
            logging.captureWarnings(False)
