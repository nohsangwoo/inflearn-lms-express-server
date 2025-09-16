import fs from "node:fs";
import path from "node:path";
import { createElevenLabsClient, type DubbingLanguageCode, type DubbingHooks } from "../lib/elevenlabs.js";
import { extractAudioFromVideo, muxVideoWithAudio } from "../lib/ffmpeg.js";
import { saveUnknownToFile, type DownloadInput } from "../lib/save.js";

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
    outputVideoPath: string;
}

export async function dubVideoWithElevenLabs(req: DubbingRequest, hooks?: DubbingHooks): Promise<DubbingResult> {
    const { targetLanguage } = req;
    const outputDir = req.outputDir ?? path.join(process.cwd(), "public");

    let inputVideoPath = req.inputVideoPath ?? "";
    if (!inputVideoPath && req.inputVideoUrl) {
        const tempPath = path.join(outputDir, `download.${Date.now()}.mp4`);
        await saveUnknownToFile(req.inputVideoUrl, tempPath);
        inputVideoPath = tempPath;
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

    let savedViaDirectVideo = false;
    try {
        const anyClient = elevenlabs as unknown as { dubbing?: { video?: { get?: (id: string, lang: string) => Promise<unknown> } } };
        if (anyClient?.dubbing?.video?.get) {
            const dubbedVideoResult = await anyClient.dubbing.video.get(dubbingId, targetLanguage);
            if (dubbedVideoResult) {
                await saveUnknownToFile(dubbedVideoResult as DownloadInput, outputVideoPath);
                savedViaDirectVideo = true;
            }
        }
    } catch {
        // 무시하고 오디오 기반 합성으로 진행
    }

    if (!savedViaDirectVideo) {
        const dubbedAudioResp = await (elevenlabs as unknown as { dubbing: { audio: { get: (id: string, lang: string) => Promise<unknown> } } }).dubbing.audio.get(dubbingId, targetLanguage);
        const dubbedAudioPath = path.join(outputDir, `${path.parse(inputVideoPath).name}.dub.${targetLanguage}.mp3`);
        const audioDownload = (dubbedAudioResp as unknown as { data?: unknown }).data ?? dubbedAudioResp;
        await saveUnknownToFile(audioDownload as DownloadInput, dubbedAudioPath);

        await muxVideoWithAudio(inputVideoPath, dubbedAudioPath, outputVideoPath);
    }

    await hooks?.afterMux?.({ outputVideoPath, targetLanguage });

    return { dubbingId, outputVideoPath };
}


