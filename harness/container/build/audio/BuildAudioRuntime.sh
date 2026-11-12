#!/bin/sh
set -eu
# Linux compilation only; the caller supplies checksum-verified source directories.
[ "$#" -eq 3 ] || { echo 'Usage: BuildAudioRuntime.sh RUNTIME LAME_SOURCE FFMPEG_SOURCE' >&2; exit 64; }
root=$1
lame_source=$2
ffmpeg_source=$3
cd "$lame_source"
./configure --prefix="$root" --enable-shared --disable-static --disable-frontend --disable-decoder
make -j2
make install
cp COPYING "$root/licenses/LAME-COPYING"
cd "$ffmpeg_source"
PKG_CONFIG_PATH="$root/lib/pkgconfig" ./configure --prefix="$root" \
  --disable-autodetect --disable-gpl --disable-nonfree --disable-version3 \
  --enable-shared --disable-static --disable-doc --disable-debug --disable-x86asm \
  --enable-libmp3lame --enable-libpulse --extra-cflags="-I$root/include" --extra-ldflags="-L$root/lib"
make -j2
make install
cp COPYING.LGPLv2.1 "$root/licenses/FFmpeg-COPYING.LGPLv2.1"
cp config.h ffbuild/config.mak "$root/sources/"
find "$root/lib" -type f -name '*.so*' -exec patchelf --set-rpath '$ORIGIN' '{}' \;
patchelf --set-rpath '$ORIGIN/../lib' "$root/bin/ffmpeg" "$root/bin/ffprobe"
"$root/bin/ffmpeg" -L > "$root/licenses/FFmpeg-build-license.txt" 2>&1
cp /usr/share/doc/libpulse0/copyright "$root/licenses/libpulse-copyright"
