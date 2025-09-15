// 실제 비지니스 로직이 들어갈 곳.
// 지금은 DB를 쓰지않고 요청 검증용 모킹데이터로 동작을 보여줌

import { createRouter } from "../lib/typed-router.js";
import { CreateUserSchema } from "./user.js";
import { z } from "zod";

export const router = createRouter();


router.post("/", (req, res)=>{
    
    const parsed = CreateUserSchema.safeParse(req.body);

    if(!parsed.success){
        const tree = z.treeifyError(parsed.error);
        return res.status(400).json({ error: "ValidationError", issues: tree})
    }

    // 성공 시 모킹된 유저를 만들어 반환 
    const user = { id: crypto.randomUUID(), ...parsed.data  };

    // 201 Created: 새 리소스가 생성됐다는 의미
     res.status(201).json(user);
})