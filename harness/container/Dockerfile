FROM node:24.14.0-bookworm-slim

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
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*
COPY harness/container/entrypoint.sh /opt/redencut-entrypoint.sh
COPY harness/container/supervise.mjs /opt/redencut-supervise.mjs
COPY harness/container/start-audio.sh /opt/redencut-start-audio.sh
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix
USER node
RUN git config --global --add safe.directory /workspace
ENTRYPOINT ["/usr/bin/tini", "--", "/bin/sh", "/opt/redencut-entrypoint.sh"]
CMD ["node", "--import", "tsx", "harness/server.ts"]
