import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";

const s3 = new S3Client({ region: env.AWS_REGION! });

export async function uploadDirToS3(localDir: string, prefix: string): Promise<void> {
    const files = await walk(localDir);
    console.log("[S3 Upload] Found files:", files.length, files.map(f => path.relative(localDir, f)));
    await Promise.all(files.map(async (f) => {
        const relativePath = path.relative(localDir, f);
        const key = (prefix + relativePath).split(path.sep).join("/");
        const Body = await fs.readFile(f);
        const mimeType = mimeFor(key);
        console.log("[S3 Upload] Uploading:", key, Body.length, "bytes, type:", mimeType);
        await s3.send(new PutObjectCommand({
            Bucket: env.AWS_BUCKET_NAME!,
            Key: key,
            Body,
            ContentType: mimeType,
            CacheControl: cacheFor(key),
        }));
    }));
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
    for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            await walk(p, acc); // acc is passed by reference, so it accumulates
        } else {
            acc.push(p);
        }
    }
    return acc;
}

function mimeFor(key: string): string | undefined {
    const lower = key.toLowerCase();
    if (lower.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
    if (lower.endsWith(".m4s")) return "video/iso.segment";
    if (lower.endsWith(".mp4")) return "video/mp4";
    if (lower.endsWith(".mp3")) return "audio/mpeg";
    if (lower.endsWith(".wav")) return "audio/wav";
}

function cacheFor(key: string): string | undefined {
    const lower = key.toLowerCase();
    if (lower.endsWith(".m3u8")) return "public, max-age=60";
    if (lower.endsWith(".m4s")) return "public, max-age=31536000, immutable";
    if (lower.endsWith(".mp4")) return "public, max-age=31536000, immutable";
    return undefined;
}