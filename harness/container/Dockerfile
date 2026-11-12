ARG REDENCUT_RUNTIME_ROOT=/opt/redencut-runtime
FROM node:24.14.0-bookworm-slim AS audio-runtime
ARG REDENCUT_RUNTIME_ROOT
ENV REDENCUT_RUNTIME_ROOT=${REDENCUT_RUNTIME_ROOT}
WORKDIR /workspace
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils build-essential pkg-config patchelf libpulse-dev \
    && rm -rf /var/lib/apt/lists/*
COPY runtime/runtime-lock.json ./runtime/runtime-lock.json
COPY scripts/runtime/RuntimeLock.mjs scripts/runtime/DownloadRuntimeSource.mjs scripts/runtime/RuntimeIntegrity.mjs ./scripts/runtime/
COPY harness/container/build/LinuxRuntimeBuild.mjs ./harness/container/build/LinuxRuntimeBuild.mjs
COPY harness/container/build/audio/BuildAudioRuntime.mjs harness/container/build/audio/BuildAudioRuntime.sh ./harness/container/build/audio/
RUN node harness/container/build/audio/BuildAudioRuntime.mjs
COPY harness/container/build/audio/WriteAudioManifest.mjs ./harness/container/build/audio/WriteAudioManifest.mjs
RUN node harness/container/build/audio/WriteAudioManifest.mjs

FROM node:24.14.0-bookworm-slim
ARG REDENCUT_RUNTIME_ROOT
ENV REDENCUT_RUNTIME_ROOT=${REDENCUT_RUNTIME_ROOT}

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates git procps lsof unzip xvfb xauth tini \
    libgtk-3-0 libnss3 libasound2 libgbm1 libdrm2 libxss1 \
    libatk-bridge2.0-0 libx11-xcb1 libxkbcommon0 libxshmfence1 \
    fonts-liberation fonts-noto-cjk fonts-noto-color-emoji pulseaudio pulseaudio-utils \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund \
    && sha256sum package.json package-lock.json > /opt/redencut-dependencies.sha256 \
    && mkdir -p out .harness-runs \
    && chown -R node:node /workspace
COPY --from=audio-runtime ${REDENCUT_RUNTIME_ROOT} ${REDENCUT_RUNTIME_ROOT}
COPY --from=audio-runtime --chown=node:node /workspace/runtime ./runtime
COPY --from=audio-runtime --chown=node:node /workspace/scripts/runtime ./scripts/runtime
COPY --from=audio-runtime --chown=node:node /workspace/harness/container/build ./harness/container/build
ENV PATH="${REDENCUT_RUNTIME_ROOT}/bin:${PATH}"
COPY harness/container/lifecycle/Entrypoint.sh /opt/redencut-entrypoint.sh
COPY harness/container/lifecycle/SuperviseCommand.mjs /opt/redencut-supervise.mjs
COPY harness/container/lifecycle/StartAudio.sh /opt/redencut-start-audio.sh
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
USER node
RUN git config --global --add safe.directory /workspace
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "/opt/redencut-entrypoint.sh"]
CMD ["node", "--import", "tsx", "harness/server.ts"]
