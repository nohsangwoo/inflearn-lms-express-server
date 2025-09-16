import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { uploadDirToS3 } from "../src/lib/s3-upload-dir.js";
import { upsertMasterPlaylist } from "../src/lib/media/hls-master.js";

const SEG_DUR = 4;

async function main() {
    const sectionId = process.argv[2];
    const inputMp4 = process.argv[3];
    if (!sectionId || !inputMp4) {
        console.error("Usage: pnpm tsx scripts/pack-hls.ts <sectionId> <path/to/video.mp4>");
        process.exit(1);
    }

    const outRoot = path.resolve(".tmp", `section-${sectionId}`);
    const videoDir = path.join(outRoot, "video");
    await fs.mkdir(videoDir, { recursive: true });

    await execa("ffmpeg", [
        "-y",
        "-i", inputMp4,
        "-map", "0:v:0",
        "-c:v", "libx264",
        "-profile:v", "main",
        "-level", "4.1",
        "-preset", "veryfast",
        "-crf", "20",
        "-x264-params", "keyint=48:min-keyint=48:scenecut=0",
        "-start_number", "0",
        "-hls_time", String(SEG_DUR),
        "-hls_playlist_type", "vod",
        "-hls_segment_type", "fmp4",
        "-hls_flags", "independent_segments",
        "-hls_segment_filename", path.join(videoDir, "v_%03d.m4s"),
        path.join(videoDir, "video.m3u8"),
    ], { stdio: "inherit" });

    const masterPath = path.join(outRoot, "master.m3u8");
    await upsertMasterPlaylist({ masterPath, videoM3u8Rel: "video/video.m3u8", audioEntries: [] });

    const prefix = `assets/curriculumsection/${sectionId}/`;
    await uploadDirToS3(outRoot, prefix);
    console.log("DONE: video packaged & uploaded.");
}

main().catch((e) => { console.error(e); process.exit(1); });


