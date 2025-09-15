// 모든 라우트에서 던진 에러를 한곳에서 처리하는 장치.
//  express 5는 async 오류 전파가 개선돼서 try/catch 남발을 줄일 수 있음

import type { ErrorRequestHandler } from "express";

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
    // pino-http를 쓰면 req.log가 자동으로 들어옴
    req.log?.error?.(err);

    // 에러 객체에 status가 있으면 사용, 없으면 500
    const status = typeof err?.status === "number" ? err.status : 500;

    // 사용자에게는 내부 세부정보 대신 메시지만 노출
    const message = err?.message ?? "Internal Server Error";

    // 에러 응답은 JSON으로 통일 (클라이언트가 다루기 쉬움)
    res.status(status).json({ error: message });


};