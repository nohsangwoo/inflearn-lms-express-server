import { Router } from "express";
import type { Router as ExpressRouter, Request } from "express";
import { dubVideoWithElevenLabs } from "../services/dubbing.js";
import type { DubbingLanguageCode } from "../lib/elevenlabs.js";

export const router: ExpressRouter = Router();

interface BodyShape {
    inputVideoPath?: string;
    inputVideoUrl?: string;
    targetLanguage: DubbingLanguageCode;
    outputDir?: string;
    apiKey?: string;
}

function validateBody(req: Request): BodyShape {
    const { inputVideoPath, inputVideoUrl, targetLanguage, outputDir, apiKey } = req.body ?? {} as Partial<BodyShape>;
    if ((!inputVideoPath || inputVideoPath.length === 0) && (!inputVideoUrl || inputVideoUrl.length === 0)) {
        const err = new Error("inputVideoPath 또는 inputVideoUrl 중 하나가 필요합니다") as Error & { status?: number };
        err.status = 400;
        throw err;
    }
    const allowed: readonly DubbingLanguageCode[] = [
        "ar","bg","cs","da","de","el","en","es","fi","fr",
        "he","hi","hu","id","it","ja","ko","ms","nl","no",
        "pl","pt","ro","ru","sk","sv","th","tr","uk","vi",
        "zh","fil"
    ];
    if (!allowed.includes(targetLanguage)) {
        const err = new Error("지원하지 않는 targetLanguage 입니다") as Error & { status?: number };
        err.status = 400;
        throw err;
    }
    return { inputVideoPath, inputVideoUrl, targetLanguage, outputDir, apiKey } as BodyShape;
}

router.post("/", async (req, res, next) => {
    try {
        const body = validateBody(req);
        const result = await dubVideoWithElevenLabs(body, {
            beforeExtract: async ({ inputVideoPath, targetLanguage }) => {
                req.log?.info?.({ inputVideoPath, targetLanguage }, "dubbing.beforeExtract");
            },
            beforeCreate: async ({ targetLanguage }) => {
                req.log?.info?.({ targetLanguage }, "dubbing.beforeCreate");
            },
            afterAudioReady: async ({ dubbingId, targetLanguage }) => {
                req.log?.info?.({ dubbingId, targetLanguage }, "dubbing.afterAudioReady");
            },
            afterMux: async ({ outputVideoPath, targetLanguage }) => {
                req.log?.info?.({ outputVideoPath, targetLanguage }, "dubbing.afterMux");
            }
        });
        res.json({ ok: true, ...result });
    } catch (err) {
        next(err);
    }
});


