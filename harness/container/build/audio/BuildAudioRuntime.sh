#!/bin/sh
set -eu
# A minimal, explicitly inventoried runtime for the Linux UI harness.
# No system ffmpeg package or GPL codec libraries are included.
root=/opt/redencut-runtime
mkdir -p "$root/sources" "$root/licenses"
cd /tmp
curl --fail --location --retry 3 https://downloads.sourceforge.net/project/lame/lame/3.100/lame-3.100.tar.gz -o lame.tar.gz
printf '%s  %s\n' ddfe36cab873794038ae2c1210557ad34857a4b6bdc515785d1da9e175b1da1e lame.tar.gz | sha256sum -c -
tar xf lame.tar.gz
cd lame-3.100
./configure --prefix="$root" --enable-shared --disable-static --disable-frontend --disable-decoder
make -j2
make install
cp COPYING "$root/licenses/LAME-COPYING"
cp /tmp/lame.tar.gz "$root/sources/lame-3.100.tar.gz"
cd /tmp
curl --fail --location --retry 3 https://ffmpeg.org/releases/ffmpeg-7.1.5.tar.xz -o ffmpeg.tar.xz
printf '%s  %s\n' de668509caf9e35e3cd162473441fdb29538c6d96ed080292b3cf9e6fc5d558f ffmpeg.tar.xz | sha256sum -c -
tar xf ffmpeg.tar.xz
cd ffmpeg-7.1.5
PKG_CONFIG_PATH="$root/lib/pkgconfig" ./configure --prefix="$root" \
  --disable-autodetect --disable-gpl --disable-nonfree --disable-version3 \
  --enable-shared --disable-static --disable-doc --disable-debug --disable-x86asm \
  --enable-libmp3lame --enable-libpulse --extra-cflags="-I$root/include" --extra-ldflags="-L$root/lib"
make -j2
make install
cp COPYING.LGPLv2.1 "$root/licenses/FFmpeg-COPYING.LGPLv2.1"
cp config.h ffbuild/config.mak "$root/sources/"
cp /tmp/ffmpeg.tar.xz "$root/sources/ffmpeg-7.1.5.tar.xz"
find "$root/lib" -type f -name '*.so*' -exec patchelf --set-rpath '$ORIGIN' '{}' \;
patchelf --set-rpath '$ORIGIN/../lib' "$root/bin/ffmpeg" "$root/bin/ffprobe"
"$root/bin/ffmpeg" -L > "$root/licenses/FFmpeg-build-license.txt" 2>&1

cp /usr/share/doc/libpulse0/copyright "$root/licenses/libpulse-copyright"
