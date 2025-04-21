# 📹 MiroTalk Bot

A simple headless (or headful) bot built with **Node.js** and **Puppeteer** that can:

- Join a [MiroTalk P2P](https://github.com/miroslavpejic85/mirotalk) meeting
- Mute its microphone and camera
- Automatically **leave the meeting** if it's the only participant (checked every 30 seconds)

---

## 🚀 Features

- ✅ Joins MiroTalk meeting via `JOIN_URL`
- ✅ Sets bot display name
- ✅ Automatically disables microphone and camera
- ✅ Detects if it's alone in the room
- ✅ Leaves the meeting when alone

---

## 🛠 Requirements

- Node.js 18+
- npm
- Chrome/Chromium (automatically downloaded by Puppeteer)
- MiroTalk instance (P2P mode recommended)

---

## 📦 Installation

```bash
git clone https://github.com/your-username/mirotalk-bot.git
cd mirotalk-bot
npm install
