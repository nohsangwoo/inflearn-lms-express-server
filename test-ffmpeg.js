import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

async function test() {
    const tmpDir = path.join(os.tmpdir(), `test-ffmpeg-${Date.now()}`);
    const videoDir = path.join(tmpDir, 'video');

    console.log('Creating directories:', { tmpDir, videoDir });
    await fs.mkdir(videoDir, { recursive: true });

    const inputUrl = 'https://storage.lingoost.com/test/testvideo.mp4';

    try {
        // Run FFmpeg
        console.log('Running FFmpeg...');
        const cmd = [
            'ffmpeg',
            '-y',
            '-i', inputUrl,
            '-map', '0:v:0',
            '-c:v', 'libx264',
            '-preset', 'veryfast',
            '-crf', '23',
            '-x264-params', 'keyint=48:min-keyint=48:scenecut=0',
            '-start_number', '0',
            '-hls_time', '4',
            '-hls_playlist_type', 'vod',
            '-hls_segment_type', 'fmp4',
            '-hls_fmp4_init_filename', 'init.mp4',
            '-hls_flags', 'independent_segments',
            '-hls_segment_filename', path.join(videoDir, 'v_%03d.m4s'),
            path.join(videoDir, 'video.m3u8')
        ].join(' ');

        execSync(cmd, { stdio: 'inherit' });

        console.log('\nChecking generated files...');

        // Check video directory
        const videoFiles = await fs.readdir(videoDir);
        console.log('Video dir files:', videoFiles);

        // Check for init.mp4 in video dir
        for (const file of videoFiles) {
            const stat = await fs.stat(path.join(videoDir, file));
            console.log(`  ${file}: ${stat.size} bytes`);
        }

        // Check temp directory (parent)
        const tmpFiles = await fs.readdir(tmpDir);
        console.log('\nTemp dir files:', tmpFiles);

        // Check current directory
        try {
            await fs.stat('init.mp4');
            console.log('\nWARNING: init.mp4 found in CURRENT directory!');
        } catch {}

    } finally {
        // Cleanup
        await fs.rm(tmpDir, { recursive: true, force: true });
    }
}

test().catch(console.error);