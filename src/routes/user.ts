import { z } from "zod";
export const CreateUserSchema = z.object({
    email: z.email(),
    name: z.string().min(1),
})

// 타입 추론을 통해 라우트 코드에서도 안전하게 사용 가능
export type CreateUser = z.infer<typeof CreateUserSchema>;