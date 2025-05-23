FROM ubuntu:latest

ENV DEBIAN_FRONTEND=noninteractive

# Install dependencies
RUN apt-get update && apt-get install -y \
    ffmpeg \
    pulseaudio \
    xvfb \
    x11-utils \
    libx11-xcb1 \
    libxcb-shm0 \
    libxcb-xinerama0 \
    libxcb-randr0 \
    libnss3 \
    libxss1 \
    libasound2t64 \
    software-properties-common \
    wget curl unzip gnupg ca-certificates \
    && apt-get clean

# Add OBS PPA and install OBS
RUN add-apt-repository ppa:obsproject/obs-studio -y && \
    apt-get update && apt-get install -y obs-studio

# Set up working directory
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .

# Copy OBS config
COPY obs-config/ /root/.config/obs-studio/

# Expose WebSocket port
EXPOSE 4455

CMD ["sh", "-c", "while true; do sleep 3600; done"]

#CMD ["xvfb-run", "--server-args=-screen 0 1280x720x24", "node", "your-script.js"]
