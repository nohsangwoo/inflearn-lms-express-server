import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "./env.js";

const region = env.AWS_REGION;
if (!region) throw new Error("AWS_REGION not set");
const s3 = new S3Client({
    region,
    ...(env.AWS_ACCESS_KEY && env.AWS_SECRET_KEY
        ? { credentials: { accessKeyId: env.AWS_ACCESS_KEY, secretAccessKey: env.AWS_SECRET_KEY } }
        : {}),
});

export async function downloadFromS3(key: string): Promise<Buffer> {
    const bucket = env.AWS_BUCKET_NAME;
    if (!bucket) throw new Error("AWS_BUCKET_NAME not set");

    const response = await s3.send(new GetObjectCommand({
        Bucket: bucket,
        Key: key
    }));

    const body = response.Body;
    if (!body) throw new Error(`No body in S3 response for key: ${key}`);

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const reader = body.transformToWebStream().getReader();
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c)));
}

export async function downloadTextFromS3(key: string): Promise<string> {
    const buffer = await downloadFromS3(key);
    return buffer.toString('utf-8');
}

export async function downloadToFile(key: string, filePath: string): Promise<void> {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");

    const buffer = await downloadFromS3(key);
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(filePath, buffer);
}