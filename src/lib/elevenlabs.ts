import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { env } from "./env.js";

export type DubbingLanguageCode =
  | "ar" | "bg" | "cs" | "da" | "de" | "el" | "en" | "es" | "fi" | "fr"
  | "he" | "hi" | "hu" | "id" | "it" | "ja" | "ko" | "ms" | "nl" | "no"
  | "pl" | "pt" | "ro" | "ru" | "sk" | "sv" | "th" | "tr" | "uk" | "vi"
  | "zh" | "fil";

export interface DubbingHooks {
    beforeExtract?(params: { inputVideoPath: string; targetLanguage: DubbingLanguageCode }): Promise<void> | void;
    beforeCreate?(params: { targetLanguage: DubbingLanguageCode }): Promise<void> | void;
    afterAudioReady?(params: { dubbingId: string; targetLanguage: DubbingLanguageCode }): Promise<void> | void;
    afterMux?(params: { outputVideoPath: string; targetLanguage: DubbingLanguageCode }): Promise<void> | void;
}

export function createElevenLabsClient(apiKeyOverride?: string): ElevenLabsClient {
    const apiKey = apiKeyOverride ?? env.ELEVENLABS_API_KEY;
    if (!apiKey) {
        throw new Error("ELEVENLABS_API_KEY가 설정되어 있지 않습니다. .env에 설정하거나 apiKey를 전달하세요.");
    }
    return new ElevenLabsClient({ apiKey });
}


