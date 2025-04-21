const puppeteer = require('puppeteer');



const MEETING_URL = 'https://13.51.238.149/join/31102ShinyGrape';
const BOT_NAME = process.env.BOT_NAME || 'Bot Recorder';

(async () => {
    const browser = await puppeteer.launch({
        headless: true, // true if you're using Docker + Xvfb
        ignoreHTTPSErrors: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--allow-insecure-localhost',
            '--start-fullscreen',
        ]
    });

    const [page] = await browser.pages();

    // Patch media APIs to avoid prompts
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
            value: {
                getUserMedia: () => Promise.reject(new Error('Permission denied by bot')),
                enumerateDevices: () => Promise.resolve([]),
                getSupportedConstraints: () => ({})
            }
        });
    });

    await page.goto(MEETING_URL, { waitUntil: 'domcontentloaded' });
    console.log('🌐 MiroTalk page loaded:', MEETING_URL);

    // Set bot name
    await page.waitForSelector('#usernameInput', { timeout: 15000 });
    await page.type('#usernameInput', BOT_NAME);

    // Optional: mute mic/cam before joining
    await new Promise(resolve => setTimeout(resolve, 1000)); // let buttons load

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
        console.warn('⚠️ Cam toggle not found');
    }

    // Handle new meeting tab
    const newPagePromise = new Promise(resolve => {
        browser.once('targetcreated', async target => {
            const newPage = await target.page();
            await newPage.bringToFront();
            resolve(newPage);
        });
    });

    await page.waitForSelector('.swal2-confirm', { visible: true });
    await page.evaluate(() => {
        const joinBtn = document.querySelector('.swal2-confirm');
        if (joinBtn) joinBtn.click();
    });

    const meetingPage = await newPagePromise;
    console.log('🎥 Joined meeting successfully as:', BOT_NAME);

    // Keep the bot alive in the room
    await new Promise(resolve => setTimeout(resolve, 60 * 1000)); // stay 1 minute for now

    await browser.close();
    console.log('👋 Bot left the meeting and closed the browser');
})();
