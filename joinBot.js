const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { spawn, execSync } = require('child_process');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
const OBSWebSocket = require('obs-websocket-js').default;

const REGION = process.env.AWS_REGION || 'eu-north-1';
// const s3 = new S3Client({ region: REGION });

const MEETING_URL = process.env.URL;
const BOT_NAME = process.env.BOT_NAME || 'Bot Recorder';

process.env.DISPLAY = ':99';

(async () => {
    const obs = new OBSWebSocket();

    // Connect to OBS WebSocket
    try {
        await obs.connect('ws://localhost:4455');
        console.log('✅ Connected to OBS WebSocket');
    } catch (err) {
        console.error('❌ Failed to connect to OBS WebSocket:', err);
        process.exit(1);
    }

    // Setup audio
    try {
        execSync('pactl load-module module-null-sink sink_name=bot_sink');
    } catch {
        console.warn('⚠️ Failed to load null sink (maybe already exists)');
    }

    // Launch browser
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
        ],
    });

    const [page] = await browser.pages();
    await page.setViewport({ width: 1280, height: 720 });

    // Disable mic/cam permissions
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
            value: {
                getUserMedia: () => Promise.reject(new Error('Permission denied by bot')),
                enumerateDevices: () => Promise.resolve([]),
                getSupportedConstraints: () => ({}),
            },
        });
    });

    await page.goto(MEETING_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('🌐 Page loaded:', MEETING_URL);

    await page.waitForSelector('#usernameInput', { timeout: 15000 });
    await page.type('#usernameInput', BOT_NAME);
    await new Promise(r => setTimeout(r, 1000));

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

    // Start OBS recording
    await obs.call('StartRecording');
    console.log('📽️ OBS recording started');

    // 🕵️ Participant monitor loop
    let recordPath = null;
    while (true) {
        await new Promise(r => setTimeout(r, 5000));
        try {
            const participantCount = await page.evaluate(() => {
                return document.querySelectorAll('video').length;
            });

            console.log(`👥 Participant count: ${participantCount}`);

            if (participantCount <= 2) {
                console.log('👤 Bot is alone. Leaving meeting...');
                await obs.call('StopRecording');
                console.log('🛑 OBS recording stopped');

                const { recordFilename } = await obs.call('GetRecordStatus');
                recordPath = recordFilename;
                console.log(`📁 OBS saved recording to: ${recordPath}`);

                await browser.close();
                break;
            }
        } catch (err) {
            console.error('❌ Error while checking participants:', err.message);
            await obs.call('StopRecording');
            await browser.close();
            break;
        }
    }

    // if (!recordPath || !fs.existsSync(recordPath)) {
    //     console.error('❌ No valid recording found. Skipping upload.');
    //     return;
    // }

    // const bucketName = 'skillzzy-video-recording';
    // const key = path.basename(recordPath);
    //
    // async function uploadFile() {
    //     const fileStream = fs.createReadStream(recordPath);
    //     try {
    //         const uploadParams = {
    //             Bucket: bucketName,
    //             Key: key,
    //             Body: fileStream,
    //         };
    //         const result = await s3.send(new PutObjectCommand(uploadParams));
    //         console.log('✅ Upload successful:', result);
    //     } catch (err) {
    //         console.error('❌ Upload error:', err);
    //     }
    // }
    //
    // await uploadFile();
})();
