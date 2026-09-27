#!/bin/sh
# Sourced by entrypoint: this private device is never connected to host audio.
mkdir -m 700 /tmp/redencut-audio
export PULSE_SERVER=unix:/tmp/redencut-audio/native
export PULSE_SINK=redencut_test
pulseaudio --daemonize=no --exit-idle-time=-1 --use-pid-file=no --disallow-exit -n \
  --load='module-native-protocol-unix socket=/tmp/redencut-audio/native auth-anonymous=1' \
  --load='module-null-sink sink_name=redencut_test rate=48000 channels=2' >&2 &
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
pactl set-default-sink redencut_test >&2
pactl set-sink-volume redencut_test 100% >&2
export REDENCUT_CONTAINER_AUDIO=1
