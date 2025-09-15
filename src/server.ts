// 실제 진입점

import { createServer} from "node:http";
import { createApp } from "./app.js";
import dotenv from "dotenv";
import { env } from "./lib/env.js";
dotenv.config();

const app = createApp();
const server = createServer(app);

// 환경변수에서 읽은 포트로 서버 시작
server.listen(Number(env.PORT), () => {
    console.log(`Server is running on port ${env.PORT}`);
});



// 종료 신호(SIGINT/Ctrl+c, SIGTERM) 처리
process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());