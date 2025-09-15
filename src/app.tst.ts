// 최소 테스트

import { describe, it, expect } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("app", () => {
    const app = createApp();

    it("GET /health -> 200 ok", async () =>{
        const res =await request(app).get("/health");
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("ok")
    })


    it("POST /users validation -> 400 on bad input", async () => {
        const res = await request(app).post("/users").send({
            email: "bad"
        })
        expect(res.status).toBe(400);
    })


})