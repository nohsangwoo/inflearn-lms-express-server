import path from "node:path";
import fs from "node:fs/promises";
import { execa } from "execa";
import { uploadDirToS3 } from "../src/lib/s3-upload-dir.js";
import { patchMasterAddAudio } from "../src/lib/media/hls-master.js";

const SEG_DUR = 4;

async function normalizeAndAlign(input: string, outWav: string, offsetMs = 0) {
    const af: string[] = ["loudnorm=I=-16:LRA=11:TP=-1.5"]; // -16 LUFS, 기본 권장
    if (offsetMs > 0) af.push(`adelay=${offsetMs}|${offsetMs}`);
    const filter = af.join(",");
    await execa("ffmpeg", [
        "-y",
        "-i", input,
        "-af", filter,
        "-ar", "48000",
        "-ac", "2",
        outWav,
    ], { stdio: "inherit" });
}

async function main() {
    const sectionId = process.argv[2]; // e.g., 123
    const lang = process.argv[3];      // e.g., ja
    const inputAudio = process.argv[4]; // mp3/wav path
    if (!sectionId || !lang || !inputAudio) {
        console.error("Usage: pnpm tsx scripts/add-audio-hls.ts <sectionId> <lang> <path/to/audio.mp3|wav>");
        process.exit(1);
    }

    const outDir = path.resolve(".tmp", `section-${sectionId}`, "audio", lang);
    await fs.mkdir(outDir, { recursive: true });

    const aligned = path.join(outDir, "aligned.wav");
    await normalizeAndAlign(inputAudio, aligned, 0);

    await execa("ffmpeg", [
        "-y",
        "-i", aligned,
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "48000",
        "-start_number", "0",
        "-hls_time", String(SEG_DUR),
        "-hls_playlist_type", "vod",
        "-hls_segment_type", "fmp4",
        "-hls_flags", "independent_segments",
        "-hls_segment_filename", path.join(outDir, "a_%03d.m4s"),
        path.join(outDir, "audio.m3u8"),
    ], { stdio: "inherit" });

    // master 갱신 (로컬 파일 기준) → 업로드 후 마스터도 함께 업로드 필요
    const masterPath = path.resolve(".tmp", `section-${sectionId}`, "master.m3u8");
    await patchMasterAddAudio({ masterPath, lang, name: lang, uri: `audio/${lang}/audio.m3u8`, groupId: "aud" });

    const prefix = `assets/curriculumsection/${sectionId}/`;
    await uploadDirToS3(path.resolve(".tmp", `section-${sectionId}`), prefix);
    console.log("DONE: audio packaged & uploaded, master updated.");
}

main().catch((e) => { console.error(e); process.exit(1); });


