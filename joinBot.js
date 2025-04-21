const puppeteer = require('puppeteer');



const MEETING_URL = 'https://56.228.13.149/join/35115BlueRat';
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

    // Patch media APIs to avoid mic/cam permission prompts
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

    await page.waitForSelector('#usernameInput', { timeout: 15000 });
    await page.type('#usernameInput', BOT_NAME);

    // Let mic/cam buttons load
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mute mic & camera
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

    // Join the room
    await page.waitForSelector('.swal2-confirm', { visible: true });
    await page.evaluate(() => {
        const joinBtn = document.querySelector('.swal2-confirm');
        if (joinBtn) joinBtn.click();
    });

    console.log('🎥 Joined meeting, continuing on same tab');
    const meetingPage = page;
    console.log("steam in the loop")

    console.log(`🎥 ${BOT_NAME} joined the meeting`);
    // 🔁 Check every 30 seconds if the bot is alone
    const checkInterval = 3 * 1000;
    console.log('not in the loop')

    while (true) {
        await new Promise(resolve => setTimeout(resolve, 5 * 1000));
            console.log('in side the loop')
        try {
            const participantCount = await meetingPage.evaluate(() => {
                return document.querySelectorAll('video').length;
            });

            console.log(`👥 Participant count: ${participantCount}`);

            if (participantCount <= 2) {
                console.log('👤 Bot is alone. Leaving meeting...');
                await browser.close();
                break;
            }
        } catch (err) {
            console.error('❌ Error while checking participants:', err.message);
            await browser.close();
            break;
        }
    }
})();
