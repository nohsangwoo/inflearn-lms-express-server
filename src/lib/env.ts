// 환경변수는 오타가 나기 쉬움.
// zod로 형식을 검사해서 서버 부팅 전에 잘못된 값을 바로잡음.

import { z } from "zod";

const Env = z.object({
    // NODE_ENV는 세 가지 중 하나만 허용
    NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
    PORT: z.string().optional().default("3000"),
});


// parse()에서 틀리면 애초에 서버가 뜨지 않으므로 안전함

export const env = Env.parse(process.env);