#!/bin/sh
set -eu
[ "$#" -eq 3 ] || { echo 'Usage: BuildWhisperRuntime.sh RUNTIME SOURCE BUILD_DIRECTORY' >&2; exit 64; }
root=$1
source_directory=$2
build_directory=$3
cmake -S "$source_directory" -B "$build_directory" \
  -DBUILD_SHARED_LIBS=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_EXAMPLES=ON \
  -DGGML_NATIVE=OFF -DGGML_CPU_ARM_ARCH=armv8-a
cmake --build "$build_directory" --target whisper-cli -j2
install "$build_directory/bin/whisper-cli" "$root/bin/whisper-cli"
cp "$source_directory/LICENSE" "$root/licenses/whisper.cpp-LICENSE"
