const puppeteer = require('puppeteer');
const { spawn } = require('child_process');
const fs = require('fs');

const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const path = require('path');
const REGION = process.env.AWS_REGION || 'eu-north-1';
const s3 = new S3Client({ region: REGION });


const MEETING_URL = process.env.URL;
const BOT_NAME = process.env.BOT_NAME || 'Bot Recorder';
const RECORDING_PATH = `/app/recordings/${BOT_NAME}-${Date.now()}.webm`;
const filePath = RECORDING_PATH; // todo need to be deferentially removed and simplified


process.env.DISPLAY = ':99';

(async () => {
    const browser = await puppeteer.launch({
        headless: false,
        ignoreHTTPSErrors: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--allow-insecure-localhost',
            '--start-fullscreen',
            '--window-size=1280,720',
        ]
    });

    const [page] = await browser.pages();
    await page.setViewport({ width: 1280, height: 720 });

    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
            value: {
                getUserMedia: () => Promise.reject(new Error('Permission denied by bot')),
                enumerateDevices: () => Promise.resolve([]),
                getSupportedConstraints: () => ({})
            }
        });
    });

    await page.goto(MEETING_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('🌐 MiroTalk page loaded:', MEETING_URL);

    await page.waitForSelector('#usernameInput', { timeout: 15000 });
    await page.type('#usernameInput', BOT_NAME);

    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
        const micClass = await page.$eval('#initAudioBtn', el => el.className);
        if (!micClass.includes('fa-microphone-slash')) await page.click('#initAudioBtn');
    } catch {
        console.warn('⚠️ Mic toggle not found');
    }

    try {
        const camClass = await page.$eval('#initVideoBtn', el => el.className);
        if (!camClass.includes('fa-video-slash')) await page.click('#initVideoBtn');
    } catch {
        console.warn('⚠️ Camera toggle not found');
    }

    await page.waitForSelector('.swal2-confirm', { visible: true });
    await page.evaluate(() => {
        const joinBtn = document.querySelector('.swal2-confirm');
        if (joinBtn) joinBtn.click();
    });

    console.log(`🎥 ${BOT_NAME} joined the meeting`);

    // ✅ Start ffmpeg recording after joining
    console.log('📽️ Starting screen recording...');
    const { execSync } = require('child_process');

    try {
        execSync('pactl load-module module-null-sink sink_name=bot_sink');
    } catch (e) {
        console.warn('⚠️ Failed to load null sink (maybe already exists)');
    }
    const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-f', 'x11grab',
        '-video_size', '1280x720',
        '-r', '25',
        '-i', ':99',
        '-f', 'pulse',
        '-ar', '44100',
        '-ac', '2',
        '-i', 'bot_sink.monitor',
        '-c:v', 'libvpx',
        '-b:v', '2M',
        '-c:a', 'libopus',
        '-b:a', '128k',
        RECORDING_PATH
    ]);


    ffmpeg.stderr.on('data', data => {
        console.log(`ffmpeg: ${data}`);
    });

    ffmpeg.on('error', err => {
        console.error('❌ Failed to start ffmpeg:', err.message);
    });

    // 🕵️ Loop to monitor participant count
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        try {
            const participantCount = await page.evaluate(() => {
                return document.querySelectorAll('video').length;
            });

            console.log(`👥 Participant count: ${participantCount}`);

            if (participantCount <= 2) {
                console.log('👤 Bot is alone. Leaving meeting...');

                // ✅ Stop recording
                ffmpeg.kill('SIGINT');

                await browser.close();
                console.log(`📁 Recording saved to: ${RECORDING_PATH}`);
                break;
            }
        } catch (err) {
            console.error('❌ Error while checking participants:', err.message);
            ffmpeg.kill('SIGINT');
            await browser.close();
            break;
        }
    }

    const fileStream = fs.createReadStream(filePath);
    const bucketName = 'skillzzy-video-recording';
    const key = path.basename(filePath);

    async function uploadFile() {
        try {
            const uploadParams = {
                Bucket: bucketName,
                Key: key,
                Body: fileStream,
            };

            const result = await s3.send(new PutObjectCommand(uploadParams));
            console.log('Upload successful:', result);
        } catch (err) {
            console.error('Upload error:', err);
        }
    }
    await uploadFile();
})();
