const puppeteer = require('puppeteer');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

// ==================== CONFIGURATION ====================
const CONFIG = {
    // Required environment variables
    MEETING_URL: process.env.URL,
    
    // Optional configuration with defaults
    BOT_NAME: process.env.BOT_NAME || 'Bot Recorder',
    S3_BUCKET: process.env.S3,
    AWS_REGION: process.env.AWS_REGION || 'eu-north-1',
    PAUSE_TIMEOUT_MINUTES: Math.max(1, parseInt(process.env.PAUSE_TIMEOUT_MINUTES) || 1),
    MIN_RECORDING_MINUTES: Math.max(0, parseInt(process.env.MIN_RECORDING_MINUTES) || 0),
    
    // Browser settings
    VIEWPORT: { width: 1280, height: 720 },
    DISPLAY: ':99',
    
    // File paths
    get FILE_NAME() { 
        return process.env.FILENAME || `${this.BOT_NAME}-${Date.now()}.mp4`; 
    },
    get RECORDING_PATH() {
        const sanitizedFileName = path.basename(this.FILE_NAME).replace(/[^a-zA-Z0-9\-_.]/g, '_');
        return `/app/recordings/${sanitizedFileName}`;
    }
};

// Validate required configuration
if (!CONFIG.MEETING_URL) {
    console.error('ERROR: URL environment variable is required');
    process.exit(1);
}

const s3 = new S3Client({ region: CONFIG.AWS_REGION });
process.env.DISPLAY = CONFIG.DISPLAY;

// ==================== LOGGING UTILITIES ====================
const logger = {
    info: (icon, message) => console.info(`${icon} ${message}`),
    error: (icon, message) => console.error(`${icon} ${message}`),
    warn: (icon, message) => console.warn(`${icon} ${message}`),
    
    // Specific event loggers
    botJoined: () => logger.info('🤖', 'BOT JOINED: Successfully entered the meeting room'),
    participantJoined: (count) => logger.info('👥', `PARTICIPANT JOINED: ${count} remote participants now in meeting`),
    participantLeft: (count) => logger.info('👥', `PARTICIPANT LEFT: ${count} remote participants remaining`),
    recordingStarted: (segment, count) => logger.info('🎬', `RECORDING STARTED: Starting segment ${segment} with ${count} participants`),
    recordingStopped: (segment, count) => logger.info('⏹️ ', `RECORDING STOPPED: Segment ${segment} finished (${count} participants remaining)`),
    audioReady: (attempts) => logger.info('🔊', `AUDIO READY: Found after ${attempts} attempts`),
    ffmpegReady: (segment, filename) => logger.info('🎥', `FFMPEG READY: Recording segment ${segment} to ${filename}`),
    timeoutReached: (minutes) => logger.info('⏰', `TIMEOUT REACHED: No participants for ${minutes} minutes, finalizing recording`),
    concatenationSuccess: (segments) => logger.info('🔗', `CONCATENATION: Successfully merged ${segments} segments into final video`),
    recordingCompleted: (path) => logger.info('✅', `RECORDING COMPLETED: Video saved at ${path}`),
    fileSaved: (path) => logger.info('💾', `FILE SAVED: Recording available at ${path}`),
    containerAlive: () => logger.info('🔄', 'CONTAINER ALIVE: Keeping container running to preserve video files'),
    heartbeat: (path) => logger.info('🔄', `HEARTBEAT: Container active, video preserved at ${path}`),
    noRecording: () => logger.info('ℹ️ ', 'NO RECORDING: Meeting had no participants, no video created'),
    audioWarning: (attempts) => logger.warn('⚠️ ', `AUDIO WARNING: Sink not found after ${attempts} attempts, proceeding anyway`),
    concatenationFailed: (error) => logger.error('❌', `CONCATENATION FAILED: ${error}`)
};

// ==================== PARTICIPANT DETECTION ====================
const participantDetector = {
    /**
     * Counts remote participants by filtering out bot's own video elements
     */
    async getRemoteParticipantCount(page) {
        try {
            return await page.evaluate(() => {
                const allVideos = document.querySelectorAll('video');
                
                // Filter out bot's own video elements
                const remoteVideos = Array.from(allVideos).filter(video => {
                    const id = video.id || '';
                    // Exclude bot's local/preview video elements and system video elements
                    return !id.includes('myVideo') && 
                           !id.includes('initVideo') && 
                           !id.includes('local') &&
                           !id.includes('videoAudioUrlElement');
                });
                
                return remoteVideos.length;
            });
        } catch (error) {
            console.error('Error checking participant count:', error.message);
            return 0; // Default to 0 on error
        }
    }
};

// ==================== BROWSER MANAGEMENT ====================
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
            `--window-size=${CONFIG.VIEWPORT.width},${CONFIG.VIEWPORT.height}`
        ]
    });

    const [page] = await browser.pages();
    await page.setViewport(CONFIG.VIEWPORT);
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

    await page.goto(CONFIG.MEETING_URL, { waitUntil: 'networkidle2', timeout: 60000 });
    console.log('Page loaded');
}

async function joinMeeting(page) {
    console.log('Entering username...');
    await page.waitForSelector('#usernameInput', { timeout: 15000 });
    await page.type('#usernameInput', CONFIG.BOT_NAME);
    await new Promise(resolve => setTimeout(resolve, 1000));


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
    
    logger.botJoined();
}

function waitForAudio() {
    return new Promise((resolve) => {
        const start = Date.now();
        let attemptCount = 0;
        const maxAttempts = 20; // 6 seconds max (20 * 300ms)
        
        const check = setInterval(() => {
            attemptCount++;
            try {
                const output = execSync('pactl list sinks | grep "bot_sink" || true', { timeout: 1000 }).toString();
                if (output.includes('bot_sink')) {
                    clearInterval(check);
                    logger.audioReady(attemptCount);
                    resolve();
                    return;
                }
            } catch (error) {
                console.warn(`Audio check attempt ${attemptCount} failed:`, error.message);
            }
            
            if (attemptCount >= maxAttempts) {
                clearInterval(check);
                logger.audioWarning(maxAttempts);
                resolve(); // Don't block recording if audio check fails
            }
        }, 300);
    });
}

async function startRecording() {
    console.log('Starting recording...');
    await waitForAudio();

    const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-thread_queue_size', '2048',    // Increased buffer size
        '-f', 'x11grab',
        '-draw_mouse', '0',
        '-framerate', '20',
        '-video_size', '1280x720',
        '-i', ':99',
        '-thread_queue_size', '2048',    // Increased buffer size
        '-f', 'pulse',
        '-i', 'bot_sink.monitor',
        '-filter_complex', '[0:v]fps=20[v];[1:a]aresample=48000[a]', // Explicit resampling
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-g', '40',              // GOP size for better sync
        '-keyint_min', '20',     // Minimum keyframe interval
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '48000',
        '-avoid_negative_ts', 'make_zero', // Fix timestamp issues
        RECORDING_PATH
    ]);

    // Add error handling for ffmpeg process
    ffmpeg.on('error', (err) => {
        console.error('FFmpeg process error:', err);
    });

    // Limit stderr logging to prevent memory accumulation
    let stderrBuffer = '';
    ffmpeg.stderr.on('data', (data) => {
        stderrBuffer += data.toString();
        if (stderrBuffer.length > 10000) { // Keep only last 10KB
            stderrBuffer = stderrBuffer.slice(-5000);
        }
        // Only log errors, not all stderr output
        const output = data.toString();
        if (output.includes('Error') || output.includes('error') || output.includes('failed')) {
            console.error('FFmpeg error:', output.trim());
        }
    });

    ffmpeg.on('spawn', () => {
        console.log('FFmpeg process started successfully');
    });

    return ffmpeg;
}

async function stopRecordingSegment(ffmpeg, segmentNumber) {
    if (!ffmpeg || ffmpeg.killed || !ffmpeg.stdin) {
        console.log(`Segment ${segmentNumber} already stopped or invalid`);
        return;
    }
    
    console.log(`Stopping recording segment ${segmentNumber}...`);
    
    return new Promise((resolve) => {
        let resolved = false;
        
        const cleanup = () => {
            if (!resolved) {
                resolved = true;
                resolve();
            }
        };
        
        // Set multiple timeouts for graceful degradation
        const softTimeout = setTimeout(() => {
            if (!resolved) {
                console.log(`Soft timeout for segment ${segmentNumber}, sending SIGINT`);
                try { ffmpeg.kill('SIGINT'); } catch (e) {}
            }
        }, 3000);
        
        const hardTimeout = setTimeout(() => {
            if (!resolved) {
                console.log(`Hard timeout for segment ${segmentNumber}, sending SIGTERM`);
                try { ffmpeg.kill('SIGTERM'); } catch (e) {}
            }
        }, 5000);
        
        const finalTimeout = setTimeout(() => {
            if (!resolved) {
                console.log(`Final timeout for segment ${segmentNumber}, sending SIGKILL`);
                try { ffmpeg.kill('SIGKILL'); } catch (e) {}
                cleanup();
            }
        }, 7000);
        
        // Listen for process events
        const onClose = (code) => {
            clearTimeout(softTimeout);
            clearTimeout(hardTimeout); 
            clearTimeout(finalTimeout);
            console.log(`Recording segment ${segmentNumber} stopped with code: ${code}`);
            cleanup();
        };
        
        const onError = (err) => {
            clearTimeout(softTimeout);
            clearTimeout(hardTimeout);
            clearTimeout(finalTimeout);
            console.error(`FFmpeg segment ${segmentNumber} error during close:`, err.message);
            cleanup();
        };
        
        ffmpeg.once('close', onClose);
        ffmpeg.once('error', onError);
        
        // Try graceful shutdown first
        try {
            ffmpeg.stdin.write('q');
        } catch (error) {
            console.error(`Error writing 'q' to segment ${segmentNumber}:`, error.message);
            cleanup();
        }
    });
}

async function startRecordingSegment(segmentNumber) {
    const segmentPath = `/app/recordings/segment_${segmentNumber}_${Date.now()}.mp4`;
    
    await waitForAudio();

    const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-thread_queue_size', '2048',    // Increased buffer size
        '-f', 'x11grab',
        '-draw_mouse', '0',
        '-framerate', '20',
        '-video_size', '1280x720',
        '-i', ':99',
        '-thread_queue_size', '2048',    // Increased buffer size
        '-f', 'pulse',
        '-i', 'bot_sink.monitor',
        '-filter_complex', '[0:v]fps=20[v];[1:a]aresample=48000[a]', // Explicit resampling
        '-map', '[v]',
        '-map', '[a]',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-g', '40',              // GOP size for better sync
        '-keyint_min', '20',     // Minimum keyframe interval
        '-c:a', 'aac',
        '-b:a', '128k',
        '-ar', '48000',
        '-avoid_negative_ts', 'make_zero', // Fix timestamp issues
        segmentPath
    ]);

    // Add error handling for ffmpeg process
    ffmpeg.on('error', (err) => {
        console.error(`FFmpeg segment ${segmentNumber} error:`, err);
    });

    // Limit stderr logging to prevent memory accumulation
    let segmentStderrBuffer = '';
    ffmpeg.stderr.on('data', (data) => {
        segmentStderrBuffer += data.toString();
        if (segmentStderrBuffer.length > 10000) { // Keep only last 10KB
            segmentStderrBuffer = segmentStderrBuffer.slice(-5000);
        }
        // Only log errors, not all stderr output
        const output = data.toString();
        if (output.includes('Error') || output.includes('error') || output.includes('failed')) {
            console.error(`FFmpeg segment ${segmentNumber} error:`, output.trim());
        }
    });

    ffmpeg.on('spawn', () => {
        logger.ffmpegReady(segmentNumber, segmentPath.split('/').pop());
    });

    return { ffmpeg, segmentPath };
}

async function concatenateSegments(segmentPaths, outputPath) {
    if (segmentPaths.length === 0) {
        throw new Error('No segments to concatenate');
    }
    
    if (segmentPaths.length === 1) {
        // Only one segment, just rename it (only if different paths)
        console.log('Only one segment, renaming to final output');
        if (segmentPaths[0] !== outputPath) {
            fs.renameSync(segmentPaths[0], outputPath);
        }
        return;
    }
    
    console.log(`Concatenating ${segmentPaths.length} segments...`);
    
    // Debug: Check if all segment files exist and their sizes
    segmentPaths.forEach((path, index) => {
        if (fs.existsSync(path)) {
            const stats = fs.statSync(path);
            console.log(`Segment ${index + 1}: ${path} - Size: ${Math.round(stats.size / 1024)}KB`);
        } else {
            console.log(`Segment ${index + 1}: ${path} - FILE MISSING!`);
        }
    });
    
    const listFile = '/app/recordings/segments.txt';
    
    // Create file list for ffmpeg concat
    const fileList = segmentPaths.map(path => `file '${path}'`).join('\n');
    fs.writeFileSync(listFile, fileList);
    console.log('Created segments list:', fileList);
    
    try {
        // Use temporary output file to avoid overwriting input segments during concatenation
        const tempOutputPath = `${outputPath}.temp.mp4`;
        
        // Validate concatenation command safety
        if (listFile.includes('"') || listFile.includes(';') || tempOutputPath.includes('"') || tempOutputPath.includes(';')) {
            throw new Error('Invalid characters in file paths, possible injection attempt');
        }
        
        const result = execSync(`ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${tempOutputPath}"`, {
            encoding: 'utf8',
            timeout: 120000 // 2 minute timeout for concatenation
        });
        logger.concatenationSuccess(segmentPaths.length);
        
        // Check if temp output file was created and has reasonable size
        if (fs.existsSync(tempOutputPath)) {
            const tempStats = fs.statSync(tempOutputPath);
            console.log(`Temp output: ${tempOutputPath} - Size: ${Math.round(tempStats.size / 1024)}KB`);
            
            // Calculate expected minimum size (sum of segments - 30% tolerance for overhead)
            const totalExpectedSize = segmentPaths.reduce((sum, path) => {
                if (fs.existsSync(path)) {
                    return sum + fs.statSync(path).size;
                }
                return sum;
            }, 0);
            const minExpectedSize = totalExpectedSize * 0.6; // More forgiving: 60% of total size as minimum
            const maxExpectedSize = totalExpectedSize * 1.2; // Upper bound check: 120% of total size as maximum
            
            if (tempStats.size >= minExpectedSize && tempStats.size <= maxExpectedSize) {
                // Move temp file to final location
                fs.renameSync(tempOutputPath, outputPath);
                console.log(`Final output: ${outputPath} - Size: ${Math.round(tempStats.size / 1024)}KB`);
                console.log('Segments concatenated successfully');
                
                // Clean up segment files (all of them since we used a temp file)
                segmentPaths.forEach(path => {
                    if (fs.existsSync(path)) {
                        fs.unlinkSync(path);
                    }
                });
                if (fs.existsSync(listFile)) {
                    fs.unlinkSync(listFile);
                }
                console.log('Cleaned up segment files');
            } else {
                console.log(`Concatenation failed: output size ${Math.round(tempStats.size / 1024)}KB is too small, expected at least ${Math.round(minExpectedSize / 1024)}KB`);
                console.log('Keeping segment files for debugging');
                // Clean up failed temp file
                if (fs.existsSync(tempOutputPath)) {
                    fs.unlinkSync(tempOutputPath);
                }
                throw new Error('Concatenation produced corrupted output');
            }
        } else {
            console.log('Temp output file not created, keeping segment files for debugging');
            throw new Error('Concatenation failed to create output file');
        }
    } catch (error) {
        logger.concatenationFailed(error.message);
        console.log('Keeping segment files for debugging');
        // Don't clean up files on error
        throw error;
    }
}

async function waitForUsers(page) {
    console.log('Waiting for users to join...');
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const participantCount = await page.evaluate(() => 
            document.querySelectorAll('video').length
        );

        console.log(`Participants: ${participantCount}`);

        if (participantCount >= 2) { // Bot + at least one user
            console.log('Users detected, starting recording...');
            return;
        }
    }
}

async function monitorMeeting(page, initialFfmpeg, browser) {
    let currentFfmpeg = initialFfmpeg;
    let segmentNumber = 0;
    let segmentPaths = [];
    let isRecording = false;
    let emptyRoomStartTime = Date.now();
    let lastParticipantCount = -1;
    
    while (true) {
        await new Promise(resolve => setTimeout(resolve, 3000)); // Reduced from 5s to 3s
        
        const participantCount = await participantDetector.getRemoteParticipantCount(page);

        // Track participant changes and log only when they occur
        if (participantCount !== lastParticipantCount) {
            if (participantCount > lastParticipantCount) {
                logger.participantJoined(participantCount);
            } else if (participantCount < lastParticipantCount) {
                logger.participantLeft(participantCount);
            }
            lastParticipantCount = participantCount;
        }

        if (participantCount >= 1) { // At least 1 remote participant - START RECORDING
            if (!isRecording) {
                segmentNumber++;
                logger.recordingStarted(segmentNumber, participantCount);
                const segmentResult = await startRecordingSegment(segmentNumber);
                currentFfmpeg = segmentResult.ffmpeg;
                segmentPaths.push(segmentResult.segmentPath);
                isRecording = true;
                emptyRoomStartTime = null;
            }
        } else { // 1 or fewer participants - PAUSE/STOP RECORDING
            if (isRecording) {
                logger.recordingStopped(segmentNumber, participantCount);
                await stopRecordingSegment(currentFfmpeg, segmentNumber);
                isRecording = false;
                emptyRoomStartTime = Date.now();
            } else if (participantCount === 0) {
                const emptyRoomDuration = (Date.now() - emptyRoomStartTime) / 1000 / 60;
                if (emptyRoomDuration >= CONFIG.PAUSE_TIMEOUT_MINUTES) {
                    logger.timeoutReached(CONFIG.PAUSE_TIMEOUT_MINUTES);
                    await browser.close();
                    if (segmentPaths.length > 0) {
                        await concatenateSegments(segmentPaths, CONFIG.RECORDING_PATH);
                        logger.recordingCompleted(CONFIG.RECORDING_PATH);
                        return true;
                    } else {
                        logger.noRecording();
                        return false;
                    }
                }
            }
        }
    }
}

async function uploadRecording(filePath) {
    const fileStats = fs.statSync(filePath);
    const fileSizeMB = Math.round(fileStats.size / 1024 / 1024);
    console.log(`File size: ${fileSizeMB}MB`);
    
    if (fileStats.size < 1024 * 1024) {
        console.log(`File too small (${fileStats.size} bytes), likely corrupted`);
        process.exit(1);
    }
    
    const durationSeconds = parseFloat(execSync(`ffprobe -v quiet -show_entries format=duration -of csv=p=0 "${filePath}"`).toString().trim());
    const durationMinutes = Math.round(durationSeconds / 60);
    console.log(`Video duration: ${durationMinutes} minutes`);
    
    if (durationMinutes < CONFIG.MIN_RECORDING_MINUTES) {
        console.log(`Video too short (${durationMinutes} minutes), minimum ${CONFIG.MIN_RECORDING_MINUTES} minutes required, skipping upload`);
        process.exit(1);
    }
    
    console.log(`Uploading ${fileSizeMB}MB file to S3...`);
    
    const uploadTimeout = setTimeout(() => {
        console.log('Upload timeout after 10 minutes');
        process.exit(1);
    }, 10 * 60 * 1000); // 10 minutes
    
    await s3.send(new PutObjectCommand({
        Bucket: CONFIG.S3_BUCKET,
        Key: CONFIG.FILE_NAME,
        Body: fs.createReadStream(filePath)
    }));
    
    clearTimeout(uploadTimeout);
    console.log('Upload complete');
}

// ==================== MAIN EXECUTION ====================
async function main() {
    const { browser, page } = await startBrowser();
    await loadMeetingPage(page);
    await joinMeeting(page);
    
    const meetingEnded = await monitorMeeting(page, null, browser);
    
    if (meetingEnded) {
        await uploadRecording(CONFIG.RECORDING_PATH);
        logger.fileSaved(CONFIG.RECORDING_PATH);
        logger.containerAlive();
        
        // Keep the process alive to prevent file cleanup
        setInterval(() => {
            // Silent heartbeat - keeps container alive without logging
        }, 300000);
    }
}

main();
