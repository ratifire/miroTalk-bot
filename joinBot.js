const puppeteer = require('puppeteer');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const MEETING_URL = process.env.URL;
const BOT_NAME = process.env.BOT_NAME || 'Bot Recorder';
const S3_BUCKET = process.env.S3;
const AWS_REGION = process.env.AWS_REGION || 'eu-north-1';
const FILE_NAME = process.env.FILENAME || `${BOT_NAME}-${Date.now()}.mp4`;
const LOCAL_FILE_NAME = path.basename(FILE_NAME);
const RECORDING_PATH = `/app/recordings/${LOCAL_FILE_NAME}`;

const s3 = new S3Client({ region: AWS_REGION });
process.env.DISPLAY = ':99';

async function startBrowser() {
    const browser = await puppeteer.launch({
        headless: false,
        ignoreHTTPSErrors: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--ignore-certificate-errors',
            '--allow-insecure-localhost',
            '--start-fullscreen',
            '--window-size=1280,720'
        ]
    });

    const [page] = await browser.pages();
    await page.setViewport({ width: 1280, height: 720 });
    return { browser, page };
}

async function loadMeetingPage(page) {
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'mediaDevices', {
            value: {
                getUserMedia: () => Promise.reject(new Error('Bot access denied')),
                enumerateDevices: () => Promise.resolve([]),
                getSupportedConstraints: () => ({})
            }
        });
    });

    await page.goto(MEETING_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Page loaded');
}

async function joinMeeting(page) {
    console.log('Entering username...');
    await page.waitForSelector('#usernameInput', { timeout: 15000 });
    await page.type('#usernameInput', BOT_NAME);
    await new Promise(resolve => setTimeout(resolve, 1000));

    console.log('Checking audio button...');
    try {
        await page.waitForSelector('#initAudioBtn', { timeout: 5000 });
        await page.click('#initAudioBtn');
        console.log('Audio button clicked');
    } catch (error) {
        console.log('Audio button not found or not clickable, skipping');
    }

    console.log('Checking camera button...');
    try {
        await page.waitForSelector('#initVideoBtn', { timeout: 5000 });
        await page.click('#initVideoBtn');
        console.log('Camera button clicked');
    } catch (error) {
        console.log('Camera button not found or not clickable, skipping');
    }

    console.log('Waiting for join button...');
    await page.waitForSelector('.swal2-confirm', { visible: true, timeout: 15000 });
    
    console.log('Clicking join button...');
    await page.evaluate(() => {
        const joinBtn = document.querySelector('.swal2-confirm');
        if (joinBtn && joinBtn.offsetParent !== null) {
            joinBtn.click();
        } else {
            throw new Error('Join button not clickable');
        }
    });
    
    console.log('Bot joined meeting');
}

function waitForAudio() {
    return new Promise((resolve) => {
        const start = Date.now();
        const check = setInterval(() => {
            const output = execSync('pactl list sinks | grep "bot_sink" || true').toString();
            if (output.includes('bot_sink') || Date.now() - start > 5000) {
                clearInterval(check);
                resolve();
            }
        }, 300);
    });
}

async function startRecording() {
    console.log('Starting recording...');
    await waitForAudio();

    const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-thread_queue_size', '1024',
        '-f', 'x11grab',
        '-draw_mouse', '0',
        '-framerate', '20',
        '-video_size', '1280x720',
        '-i', ':99',
        '-thread_queue_size', '1024',
        '-f', 'pulse',
        '-i', 'bot_sink.monitor',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-c:a', 'aac',
        '-b:a', '128k',
        RECORDING_PATH
    ]);

    // Add error handling for ffmpeg process
    ffmpeg.on('error', (err) => {
        console.error('FFmpeg process error:', err);
    });

    ffmpeg.stderr.on('data', (data) => {
        console.error('FFmpeg stderr:', data.toString());
    });

    ffmpeg.on('spawn', () => {
        console.log('FFmpeg process started successfully');
    });

    return ffmpeg;
}

async function monitorMeeting(page, ffmpeg, browser) {
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const participantCount = await page.evaluate(() => 
            document.querySelectorAll('video').length
        );

        console.log(`Participants: ${participantCount}`);

        if (participantCount <= 2) {
            console.log('Meeting ended, stopping recording');
            
            // Gracefully stop ffmpeg by sending 'q' command
            ffmpeg.stdin.write('q');
            
            // Wait for ffmpeg to close with timeout
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    console.log('FFmpeg close timeout, forcing termination');
                    ffmpeg.kill('SIGTERM');
                    reject(new Error('FFmpeg close timeout'));
                }, 10000); // 10 second timeout
                
                ffmpeg.on('close', (code) => {
                    clearTimeout(timeout);
                    console.log(`FFmpeg closed with code: ${code}`);
                    resolve();
                });
                
                ffmpeg.on('error', (err) => {
                    clearTimeout(timeout);
                    console.error('FFmpeg error during close:', err);
                    reject(err);
                });
            });
            
            await browser.close();
            console.log('Recording saved, starting upload...');
            return true; // Return true to indicate meeting ended
        }
    }
}

async function uploadRecording(filePath) {
    console.log(`Starting upload of: ${filePath}`);
    
    if (!fs.existsSync(filePath)) {
        throw new Error(`Recording file not found: ${filePath}`);
    }
    
    const fileStats = fs.statSync(filePath);
    console.log(`File size: ${Math.round(fileStats.size / 1024 / 1024)}MB`);
    
    // Check if file is too small (likely corrupted)
    if (fileStats.size < 1024 * 1024) { // Less than 1MB
        throw new Error(`Recording file too small (${fileStats.size} bytes), likely corrupted`);
    }
    
    // Check video duration using ffmpeg
    console.log('Checking video duration...');
    try {
        const durationOutput = execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`).toString().trim();
        const durationSeconds = parseFloat(durationOutput);
        const durationMinutes = Math.round(durationSeconds / 60 * 100) / 100; // Round to 2 decimal places
        
        console.log(`Video duration: ${durationMinutes} minutes`);
        
        if (durationSeconds < 600) { // Less than 10 minutes
            throw new Error(`Video too short (${durationMinutes} minutes), minimum 10 minutes required`);
        }
        
    } catch (error) {
        if (error.message.includes('Video too short')) {
            throw error; // Re-throw duration validation error
        }
        console.error('Could not check video duration:', error.message);
        // Continue with upload if duration check fails (ffprobe might not be available)
    }
    
    const fileStream = fs.createReadStream(filePath);
    
    const params = {
        Bucket: S3_BUCKET,
        Key: FILE_NAME,
        Body: fileStream
    };

    console.log(`Uploading to S3 bucket: ${S3_BUCKET} with key: ${FILE_NAME}`);
    await s3.send(new PutObjectCommand(params));
    console.log('Upload complete');
}

async function main() {
    let browser, ffmpeg;
    
    try {
        const { browser: browserInstance, page } = await startBrowser();
        browser = browserInstance;
        
        await loadMeetingPage(page);
        await joinMeeting(page);
        
        ffmpeg = await startRecording();
        
        try {
            const meetingEnded = await monitorMeeting(page, ffmpeg, browser);
            
            if (meetingEnded) {
                await uploadRecording(RECORDING_PATH);
                console.log('Upload completed successfully');
                process.exit(0);
            }
        } catch (recordingError) {
            console.error('Recording termination error:', recordingError);
            console.log('Skipping upload due to recording issues');
            process.exit(1);
        }
        
    } catch (error) {
        console.error('Error:', error.message);
        if (ffmpeg) ffmpeg.kill('SIGINT');
        if (browser) await browser.close();
        process.exit(1);
    }
}

main();
