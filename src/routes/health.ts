import { createRouter } from "../lib/typed-router.js"


export const router = createRouter();

router.get("/", (_req, res)=>{
    res.json({ status: "ok", time: new Date().toISOString() })
})
