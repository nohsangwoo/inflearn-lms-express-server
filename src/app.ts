// 'app'은 서버의 본체
// 공통 미들웨어(보안, 파서, 로깅)와 라우트를 여기서 한 번에 연결합니다.

import express from "express";
import type { Express } from "express";
import helmet from "helmet";
import cors from "cors";
import { httpLogger } from "./lib/http-logger.js";
import { router as rootRouter } from "./routes/index.js";
import { errorHandler } from "./middlewares/error.js";



export function createApp(): Express {
    const app = express();

    // 1) 보안: 기본 보안 헤더 장착w
    app.use(helmet());

    // 2) CORS
    app.use(cors());

    // 3) 바디 파서: JSON 요청 본문을 자동으로 객체로 변환
    app.use(express.json());

    // 4) 로깅: 요청별로 req.log 사용 가능 -> 추적이 쉬워짐
    app.use(httpLogger());

    // 5) 라우트 진입: 모든 API는 여기서 시작됨
    app.use("/", rootRouter);

    // 6) 404 처리: 등록되지 않은 경로
    app.use((_req, res) => {
        res.status(404).json({ error: "Not Found"})
    });

    // 7) 에러 처리: 마지막에 연결함
    app.use(errorHandler);


    return app;
}