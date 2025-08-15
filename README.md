# 📹 MiroTalk Recording Bot

A **recording bot** built with **Node.js** and **Puppeteer** that can:

- Join a [MiroTalk P2P](https://github.com/miroslavpejic85/mirotalk) meeting
- Record video and audio of the entire meeting
- Automatically stop recording when participants leave
- Upload recordings to AWS S3

---

## 🚀 Features

- ✅ Joins MiroTalk meeting with custom bot name
- ✅ Disables bot's microphone and camera
- ✅ Records full meeting (video + audio) using FFmpeg
- ✅ Monitors participant count every 5 seconds
- ✅ Stops recording when only bot remains (≤2 participants)
- ✅ Automatically uploads recordings to AWS S3
- ✅ Clean error handling and resource cleanup

---

## 🛠 Requirements

- Node.js 18+
- npm
- Chrome/Chromium (automatically downloaded by Puppeteer)
- FFmpeg (for screen recording)
- PulseAudio (for audio capture)
- AWS S3 bucket (for recording storage)
- Virtual display (Xvfb) if running headless
- MiroTalk instance

---

## 🌍 Environment Variables

Create a `.env` file or set these environment variables:

```bash
URL=https://your-mirotalk-instance.com/join/room-id
BOT_NAME=Recording Bot
S3=your-s3-bucket-name
AWS_REGION=eu-north-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

---

## 📦 Installation

```bash
git clone https://github.com/your-username/mirotalk-bot.git
cd mirotalk-bot
npm install
```

---

## ▶️ Usage

### Local Development
```bash
# Set environment variables
export URL="https://your-mirotalk-instance.com/join/room-id"
export BOT_NAME="Recording Bot"
export S3="your-s3-bucket-name"
export AWS_REGION="eu-north-1"

# Start the bot
node joinBot.js
```

### Docker Usage
```bash
# Build the image
docker build -t mirotalk-bot .

# Run with environment variables
docker run -e URL="https://example.com/join/abc123" \
           -e BOT_NAME="Meeting Recorder" \
           -e S3="my-recordings-bucket" \
           -e AWS_REGION="eu-north-1" \
           -e AWS_ACCESS_KEY_ID="your-key" \
           -e AWS_SECRET_ACCESS_KEY="your-secret" \
           mirotalk-bot
```

---

## 📁 How It Works

1. **Browser Launch**: Bot opens a Puppeteer browser instance
2. **Meeting Join**: Navigates to the meeting URL and joins with the specified name
3. **Media Setup**: Disables bot's microphone and camera
4. **Recording Start**: Begins FFmpeg screen recording with audio capture
5. **Monitoring**: Checks participant count every 5 seconds
6. **Auto Stop**: When ≤2 participants remain, stops recording
7. **Upload**: Automatically uploads the recording to AWS S3
8. **Cleanup**: Closes browser and cleans up resources

---

## 🗂 Recording Details

- **Format**: MP4 with H.264 video and AAC audio
- **Resolution**: 1280x720 at 20fps
- **Audio**: Captured via PulseAudio null sink
- **Location**: `/app/recordings/BotName-timestamp.mp4`
- **Upload**: Automatic upload to configured S3 bucket

---

## 🐳 Docker Environment

The bot is designed to run in a containerized environment with:
- Virtual display (`:99`) via Xvfb
- PulseAudio for audio capture
- All dependencies pre-installed

---

## 📝 Notes

- Bot considers a meeting "ended" when participant count drops to 2 or fewer
- Recording starts immediately after joining the meeting
- Failed uploads will cause the bot to exit with an error
- All resources are properly cleaned up on exit or error
