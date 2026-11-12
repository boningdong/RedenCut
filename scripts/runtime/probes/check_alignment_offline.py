"""Developer check: run EN/ZH alignment with no downloads or host caches."""
import argparse
import json
import socket
from pathlib import Path


def deny_network(*args, **kwargs):
    raise AssertionError("Offline alignment must not access the network")


def block_network_and_downloads():
    socket.socket.connect = deny_network
    socket.socket.connect_ex = deny_network
    socket.create_connection = deny_network
    import nltk

    nltk.download = deny_network


def check_language(model_definition, models_root, language, text, audio):
    import whisperx

    model_path = models_root / "alignment" / model_definition["id"] / model_definition["revision"]
    model, metadata = whisperx.load_align_model(
        language_code=language,
        device="cpu",
        model_name=str(model_path),
        model_cache_only=True,
    )
    segments = [{"start": 0.0, "end": 1.0, "text": text}]
    result = whisperx.align(
        segments, model, metadata, audio, "cpu", return_char_alignments=True,
    )
    assert result["segments"], "No alignment segments for " + language
    assert any(segment.get("chars") for segment in result["segments"]), "No character alignment for " + language
    return {
        "segments": len(result["segments"]),
        "characters": sum(len(segment.get("chars", [])) for segment in result["segments"]),
    }


def check_alignment_languages(manifest_path, models_root):
    import numpy as np
    from redencut_speech_worker.nltk_resources import require_alignment_resources

    require_alignment_resources()
    models = json.loads(manifest_path.read_text())["models"]
    audio = np.random.default_rng(0).normal(0, 0.01, 16000).astype(np.float32)
    results = {}
    for language, text in [("en", "hello world"), ("zh", "你好世界")]:
        definition = next(model for model in models if model["id"] == "alignment-" + language)
        results[language] = check_language(definition, models_root, language, text, audio)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--models-root", type=Path, required=True)
    args = parser.parse_args()
    block_network_and_downloads()
    results = check_alignment_languages(args.manifest, args.models_root)
    print(json.dumps(results))


if __name__ == "__main__":
    main()
