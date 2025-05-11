FROM ghcr.io/puppeteer/puppeteer:latest

USER root

RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    xvfb \
    -y pulseaudio \
    fonts-liberation \
    libatk-bridge2.0-0 \
    libnspr4 \
    libnss3 \
    libxss1 \
    libasound2 \
    libatk1.0-0 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libgtk-3-0 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

#ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
#   PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
#  NODE_ENV=production

WORKDIR /app

COPY . .
RUN npm install
RUN mkdir -p /app/recordings
RUN npx puppeteer browsers install chrome

ENV DISPLAY=:99
ENV URL=https://51.20.65.174/newcall
#url need to be moved to something else
CMD ["sh", "-c", "pulseaudio --start --exit-idle-time=-1 --disable-shm=yes --daemonize && \
    Xvfb :99 -screen 0 1280x720x24 & \
    DISPLAY=:99 node joinBot.js"]


#CMD ["sh", "-c", "while true; do sleep 3600; done"]

#CMD ["dumb-init", "sh", "-c", \
 #"Xvfb :99 -screen 0 1280x720x24 & \
  # export DISPLAY=:99 && \
   #node joinBot.js"]
