pulseaudio --start --exit-idle-time=-1 --disable-shm=yes --daemonize
Xvfb :99 -screen 0 1280x720x24 & \
node joinBot.js
export DISPLAY=:99 && \
