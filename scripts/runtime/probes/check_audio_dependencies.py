"""Developer runtime checks for audio decoding and native-library import order."""
import argparse
import os


def check_torchcodec_first(audio_path):
    from torchcodec.decoders import AudioDecoder

    samples = AudioDecoder(audio_path).get_all_samples()
    assert samples.data.numel() > 0, "TorchCodec decoded no samples"


def check_av_first(audio_path):
    import av

    container = av.open(audio_path)
    assert next(container.decode(audio=0), None) is not None, "PyAV decoded no frames"
    import torchcodec, torch, whisperx, pyannote.audio
    import nltk

    nltk.data.path[:] = [os.environ["NLTK_DATA"]]
    nltk.data.load("tokenizers/punkt_tab/english.pickle", cache=False)
    audio = whisperx.load_audio(audio_path)
    assert audio.size > 0, "WhisperX decoded no samples"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("import_order", choices=["torchcodec-first", "av-first"])
    parser.add_argument("audio_path")
    args = parser.parse_args()
    if args.import_order == "torchcodec-first":
        check_torchcodec_first(args.audio_path)
    else:
        check_av_first(args.audio_path)
    print("torchcodec-first-ok" if args.import_order == "torchcodec-first" else "av-first-whisperx-ok")


if __name__ == "__main__":
    main()
