import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { env } from "../lib/env.js";
import { createElevenLabsClient, type DubbingLanguageCode, type DubbingHooks } from "../lib/elevenlabs.js";
import { extractAudioFromVideo } from "../lib/ffmpeg.js";
import { saveUnknownToFile, type DownloadInput } from "../lib/save.js";
import { uploadDownloadInputToS3 } from "../lib/s3.js";

// 파일 저장 유틸은 ../lib/save 에서 공용화

export interface DubbingRequest {
    inputVideoPath?: string;
    inputVideoUrl?: string;
    targetLanguage: DubbingLanguageCode;
    outputDir?: string;
    apiKey?: string;
}

export interface DubbingResult {
    dubbingId: string;
    audioUrl?: string; // S3 업로드된 더빙 오디오 URL (권장: HLS 오디오 트랙용)
    videoUrl?: string; // S3 업로드된 더빙 비디오 URL (옵션)
}

export async function dubVideoWithElevenLabs(req: DubbingRequest, hooks?: DubbingHooks): Promise<DubbingResult> {
    const { targetLanguage } = req;
    const outputDir = req.outputDir ?? env.TEMP_DIR ?? os.tmpdir();
    const tempFiles: string[] = [];

    let inputVideoPath = req.inputVideoPath ?? "";
    if (!inputVideoPath && req.inputVideoUrl) {
        // 로컬 저장 비활성화: 입력 비디오는 직접 처리 대상이지만,
        // 현재 파이프라인은 원본 비디오에서 오디오 추출이 필요하므로 임시 파일 경로가 필요합니다.
        // TODO: 추후 ffmpeg가 URL 입력을 안정적으로 처리하도록 개선 시 로컬 파일을 제거할 수 있습니다.
        const tempPath = path.join(outputDir, `download.${Date.now()}.mp4`);
        await saveUnknownToFile(req.inputVideoUrl, tempPath);
        inputVideoPath = tempPath;
        tempFiles.push(tempPath);
    }
    if (!inputVideoPath) {
        const err = new Error("inputVideoPath 또는 inputVideoUrl 중 하나가 필요합니다") as Error & { status?: number };
        err.status = 400;
        throw err;
    }

    await hooks?.beforeExtract?.({ inputVideoPath, targetLanguage });

    const { audioPath, mime } = await extractAudioFromVideo(inputVideoPath, outputDir, "m4a");
    const audioBuffer = await fs.promises.readFile(audioPath);
    const arrayBuffer = new ArrayBuffer(audioBuffer.byteLength);
    const view = new Uint8Array(arrayBuffer);
    view.set(audioBuffer);
    const inputAudioBlob = new Blob([arrayBuffer], { type: mime });
    tempFiles.push(audioPath);

    await hooks?.beforeCreate?.({ targetLanguage });

    const elevenlabs = createElevenLabsClient(req.apiKey);
    const created = await elevenlabs.dubbing.create({ file: inputAudioBlob, targetLang: targetLanguage });
    const dubbingId = (created as unknown as { dubbingId?: string; data?: { dubbingId?: string } }).dubbingId
        ?? (created as unknown as { data?: { dubbingId?: string } }).data?.dubbingId;
    if (!dubbingId) throw new Error("dubbingId를 가져오지 못했습니다");

    while (true) {
        const meta = await elevenlabs.dubbing.get(dubbingId);
        const status = (meta as unknown as { status?: string; data?: { status?: string } }).status
            ?? (meta as unknown as { data?: { status?: string } }).data?.status;
        if (status === "dubbed") break;
        await new Promise(r => setTimeout(r, 5000));
    }

    await hooks?.afterAudioReady?.({ dubbingId, targetLanguage });

    const outputVideoPath = path.join(outputDir, `${path.parse(inputVideoPath).name}.dub.${targetLanguage}.mp4`);

    try {
        const anyClient = elevenlabs as unknown as { dubbing?: { video?: { get?: (id: string, lang: string) => Promise<unknown> } } };
        if (anyClient?.dubbing?.video?.get) {
            const dubbedVideoResult = await anyClient.dubbing.video.get(dubbingId, targetLanguage);
            if (dubbedVideoResult) {
                const uploaded = await uploadDownloadInputToS3(dubbedVideoResult as DownloadInput, {
                    keyPrefix: `temp/dubbed-video/`,
                    fileName: `${path.parse(outputVideoPath).base}`,
                    contentType: "video/mp4",
                    cacheControl: "public, max-age=31536000, immutable",
                });
                await hooks?.afterMux?.({ outputVideoPath: uploaded.url, targetLanguage });
                return { dubbingId, videoUrl: uploaded.url };
            }
        }
    } catch {
        // 무시하고 오디오 기반 합성으로 진행
    }

    const dubbedAudioResp = await (elevenlabs as unknown as { dubbing: { audio: { get: (id: string, lang: string) => Promise<unknown> } } }).dubbing.audio.get(dubbingId, targetLanguage);
    const audioDownload = (dubbedAudioResp as unknown as { data?: unknown }).data ?? dubbedAudioResp;
    const uploaded = await uploadDownloadInputToS3(audioDownload as DownloadInput, {
        keyPrefix: `assets/temp/dubbed-audio/`,
        fileName: `${path.parse(outputVideoPath).name}.mp3`,
        contentType: "audio/mpeg",
        cacheControl: "public, max-age=31536000, immutable",
    });
    // 비디오/오디오 합성은 HLS 오디오 트랙 분리 전략으로 대체 예정 → 여기서는 스킵
    // 정리: 임시 파일 삭제
    try {
        await Promise.all(tempFiles.map(p => fs.promises.unlink(p).catch(() => {})));
    } catch {
        // ignore cleanup errors
    }
    return { dubbingId, audioUrl: uploaded.url };

    // unreachable
    // await hooks?.afterMux?.({ outputVideoPath, targetLanguage });
    // return { dubbingId };
}


