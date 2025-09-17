// 환경변수는 오타가 나기 쉬움.
// zod로 형식을 검사해서 서버 부팅 전에 잘못된 값을 바로잡음.

import dotenv from "dotenv";
import { z } from "zod";

// .env를 가장 먼저 로드하여 아래 Env.parse 시점에 반영되도록 함
dotenv.config();

const Env = z.object({
    // NODE_ENV는 세 가지 중 하나만 허용
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().optional().default("3000"),
    // ElevenLabs API 키 및 ffmpeg 경로(선택)
    ELEVENLABS_API_KEY: z.string().optional(),
    FFMPEG_PATH: z.string().optional(),
    // Temp directory (optional): defaults to OS tmp
    TEMP_DIR: z.string().optional(),
    // AWS / CDN
    AWS_ACCESS_KEY: z.string().optional(),
    AWS_SECRET_KEY: z.string().optional(),
    AWS_REGION: z.string().optional(),
    AWS_BUCKET_NAME: z.string().optional(),
    NEXT_PUBLIC_CDN_URL: z.string().optional(),
    CLOUDFRONT_DISTRIBUTION_ID: z.string().optional(),
});


// parse()에서 틀리면 애초에 서버가 뜨지 않으므로 안전함

export const env = Env.parse(process.env);
