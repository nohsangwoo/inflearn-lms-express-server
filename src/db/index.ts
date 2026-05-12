import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "../lib/env.js";
import * as schema from "./schema.js";

declare global {
    var __baksalDubbingSql: postgres.Sql | undefined;
}

const client =
    globalThis.__baksalDubbingSql ??
    postgres(env.DATABASE_URL, {
        max: 5,
        prepare: false,
    });

if (env.NODE_ENV !== "production") {
    globalThis.__baksalDubbingSql = client;
}

export const db = drizzle(client, { schema });
export * from "./schema.js";
