#!/bin/sh
# Sourced by entrypoint: this private device is never connected to host audio.
mkdir -m 700 /tmp/riffcut-audio
export PULSE_SERVER=unix:/tmp/riffcut-audio/native
export PULSE_SINK=riffcut_test
pulseaudio --daemonize=no --exit-idle-time=-1 --use-pid-file=no --disallow-exit -n \
  --load='module-native-protocol-unix socket=/tmp/riffcut-audio/native auth-anonymous=1' \
  --load='module-null-sink sink_name=riffcut_test rate=48000 channels=2' >&2 &
audio_pid=$!
audio_attempt=0
while ! pactl info >/dev/null 2>&1; do
  if ! kill -0 "$audio_pid" 2>/dev/null || [ "$audio_attempt" -ge 100 ]; then
    echo 'VIRTUAL_AUDIO_NOT_READY: private PulseAudio startup failed.' >&2
    exit 1
  fi
  audio_attempt=$((audio_attempt + 1))
  sleep 0.1
done
pactl set-default-sink riffcut_test >&2
pactl set-sink-volume riffcut_test 100% >&2
export RIFFCUT_CONTAINER_AUDIO=1
