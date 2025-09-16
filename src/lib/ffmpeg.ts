import ffmpeg from "fluent-ffmpeg";
// @ts-ignore
import ffmpegStatic from "ffmpeg-static";
import fs from "node:fs";
import path from "node:path";
import { env } from "./env.js";

// ffmpeg 바이너리 경로 설정 (환경변수 > ffmpeg-static > 시스템 PATH)
try {
    const envFfmpeg = env.FFMPEG_PATH;
    if (envFfmpeg && fs.existsSync(envFfmpeg)) {
        ffmpeg.setFfmpegPath(envFfmpeg);
    } else if (ffmpegStatic && fs.existsSync(ffmpegStatic as string)) {
        // @ts-ignore
        ffmpeg.setFfmpegPath(ffmpegStatic as string);
    }
} catch {
    // 설정 실패 시 시스템 PATH에 있는 ffmpeg 사용 시도
}

export async function extractAudioFromVideo(inputVideoPath: string, outputDir: string, preferredExt: string = "m4a"): Promise<{ audioPath: string; mime: string; }> {
    const base = path.parse(inputVideoPath).name;
    let outPath = path.join(outputDir, `${base}.copy.${preferredExt}`);
    let mime = "audio/mp4";

    await fs.promises.mkdir(outputDir, { recursive: true });

    try {
        await new Promise<void>((resolve, reject) => {
            ffmpeg()
                .input(inputVideoPath)
                .outputOptions(["-vn", "-acodec copy"]) // 원본 오디오 그대로 추출 시도
                .on("error", (err: any) => reject(err))
                .on("end", () => resolve())
                .save(outPath);
        });
    } catch {
        // 재인코딩 경로 (AAC)
        outPath = path.join(outputDir, `${base}.aac.${preferredExt}`);
        mime = "audio/mp4";
        await new Promise<void>((resolve, reject) => {
            ffmpeg()
                .input(inputVideoPath)
                .outputOptions(["-vn", "-c:a aac", "-b:a 192k"]) // 품질과 호환성 고려
                .on("error", (err: any) => reject(err))
                .on("end", () => resolve())
                .save(outPath);
        });
    }

    return { audioPath: outPath, mime };
}

export async function muxVideoWithAudio(inputVideoPath: string, inputAudioPath: string, outputPath: string): Promise<string> {
    await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });
    await new Promise<void>((resolve, reject) => {
        ffmpeg()
            .input(inputVideoPath)
            .input(inputAudioPath)
            .outputOptions(["-c:v copy", "-c:a aac", "-shortest", "-map 0:v:0", "-map 1:a:0"]) // 비디오 복사, 오디오 aac, 길이 짧은 쪽 기준
            .on("error", (err: any) => reject(err))
            .on("end", () => resolve())
            .save(outputPath);
    });
    return outputPath;
}


