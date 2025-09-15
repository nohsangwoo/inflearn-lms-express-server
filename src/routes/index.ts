// 라우터를 '폴더 단위'로 나눠 연결함
// 규모가 커져도 유지보수가 쉬움

import type { Router as ExpressRouter } from "express";
import { Router } from "express";
import { router as health } from "./health.js";
import { router as users } from "./users.js";

export const router: ExpressRouter = Router();

// 간단한 루트 엔드포인트: 서버가 살아있는지 확인하는 용도
router.get("/", (_req, res)=>{
    res.json({ ok: true, name: "express5-ts-starter" })
})


router.use("/health", health);
router.use("/users", users);