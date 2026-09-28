"""Diagnostic logging stays on stderr; stdout belongs to the task protocol."""
import json
import logging
import sys


class DiagnosticFormatter(logging.Formatter):
    def format(self, record):
        level = 'error' if record.levelno >= logging.ERROR else 'warn' if record.levelno >= logging.WARNING else 'info'
        message = {
            'type': 'log', 'version': 1, 'level': level,
            'logger': record.name[:96], 'message': record.getMessage()[:12000],
        }
        if record.exc_info:
            message['stack'] = self.formatException(record.exc_info)[:12000]
        return json.dumps(message, ensure_ascii=False, separators=(',', ':'))


def configure_logging(stream=None):
    root = logging.getLogger()
    for existing in list(root.handlers):
        if getattr(existing, '_redencut_diagnostics', False):
            root.removeHandler(existing)
    handler = logging.StreamHandler(stream if stream is not None else sys.stderr)
    handler._redencut_diagnostics = True
    handler.setLevel(logging.INFO)
    handler.setFormatter(DiagnosticFormatter())
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    logging.captureWarnings(True)
    return handler
