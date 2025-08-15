FROM ghcr.io/puppeteer/puppeteer:latest

USER root

# Install system dependencies in a single layer with cleanup
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    xvfb \
    pulseaudio \
    pulseaudio-utils \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

WORKDIR /app

# Copy package files first for better caching
COPY package*.json ./

# Install npm dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy application code
COPY joinBot.js ./

# Create recordings directory
RUN mkdir -p /app/recordings

# Environment variables
ENV DISPLAY=:99
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=false
ENV XDG_RUNTIME_DIR=/tmp
# URL and S3 should be provided at runtime via -e flags

# Start command
#CMD ["sh", "-c", "\
#    pulseaudio --start --exit-idle-time=-1 --disable-shm=yes --daemonize && \
#    sleep 1 && \
#    pactl load-module module-null-sink sink_name=bot_sink || true && \
#    Xvfb :99 -screen 0 1280x720x24 & \
#    sleep 2 && \
#    node joinBot.js"]

CMD ["sh", "-c", "\
    pulseaudio --start --exit-idle-time=-1 --disable-shm=yes --daemonize && \
    sleep 1 && \
    pactl load-module module-null-sink sink_name=bot_sink || true && \
    Xvfb :99 -screen 0 1280x720x24 & \
    sleep 2 && \
    node joinBot.js & \
    tail -f /dev/null"]