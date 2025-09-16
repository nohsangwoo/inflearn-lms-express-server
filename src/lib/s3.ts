import { S3Client, PutObjectCommand, CopyObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";
import { env } from "./env.js";
import type { DownloadInput } from "./save.js";
import type { Readable } from "node:stream";

const region = env.AWS_REGION;
if (!region) throw new Error("AWS_REGION not set");
const s3 = new S3Client({
	region,
	...(env.AWS_ACCESS_KEY && env.AWS_SECRET_KEY
		? { credentials: { accessKeyId: env.AWS_ACCESS_KEY, secretAccessKey: env.AWS_SECRET_KEY } }
		: {}),
});

export interface UploadParams {
	localPath: string;
	keyPrefix?: string; // e.g., assets/VID123/audio/ja/
	fileName?: string;  // override default (basename)
	contentType?: string;
	cacheControl?: string;
}

export async function uploadFileToS3(params: UploadParams): Promise<{ key: string; url: string; }> {
	const bucket = env.AWS_BUCKET_NAME;
	if (!bucket) throw new Error("AWS_BUCKET_NAME not set");
	const cdn = env.NEXT_PUBLIC_CDN_URL;
	if (!cdn) throw new Error("NEXT_PUBLIC_CDN_URL not set");

	const body = await fs.readFile(params.localPath);
	const fileName = params.fileName ?? path.basename(params.localPath);
	const key = ((params.keyPrefix ?? "") + fileName).replace(/\\/g, "/");
	await s3.send(new PutObjectCommand({
		Bucket: bucket,
		Key: key,
		Body: body,
		ContentType: params.contentType,
		CacheControl: params.cacheControl,
	}));
	const base = cdn.endsWith("/") ? cdn.slice(0, -1) : cdn;
	return { key, url: `${base}/${key}` };
}

export interface UploadBodyParams {
    body: Buffer | Uint8Array | Readable;
    keyPrefix: string;
    fileName: string;
    contentType: string;
    cacheControl?: string;
}

export async function uploadBodyToS3(params: UploadBodyParams): Promise<{ key: string; url: string; }> {
    const bucket = env.AWS_BUCKET_NAME;
    if (!bucket) throw new Error("AWS_BUCKET_NAME not set");
    const cdn = env.NEXT_PUBLIC_CDN_URL;
    if (!cdn) throw new Error("NEXT_PUBLIC_CDN_URL not set");
    const key = ((params.keyPrefix || "") + params.fileName).replace(/\\/g, "/");
    await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: params.body,
        ContentType: params.contentType,
        CacheControl: params.cacheControl,
    }));
    const base = cdn.endsWith("/") ? cdn.slice(0, -1) : cdn;
    return { key, url: `${base}/${key}` };
}

export async function uploadDownloadInputToS3(input: DownloadInput, opts: { keyPrefix: string; fileName: string; contentType: string; cacheControl?: string; }): Promise<{ key: string; url: string; }> {
    const body = await resolveDownloadInputToBuffer(input);
    return uploadBodyToS3({ body, keyPrefix: opts.keyPrefix, fileName: opts.fileName, contentType: opts.contentType, cacheControl: opts.cacheControl ?? "" });
}

export function cdnUrlForKey(key: string): string {
    const cdn = env.NEXT_PUBLIC_CDN_URL!;
    const base = cdn.endsWith("/") ? cdn.slice(0, -1) : cdn;
    return `${base}/${key}`;
}

export async function copyObjectInS3(sourceKey: string, destKey: string, opts?: { cacheControl?: string; contentType?: string }): Promise<{ key: string; url: string; }> {
    const bucket = env.AWS_BUCKET_NAME!;
    await s3.send(new CopyObjectCommand({
        Bucket: bucket,
        Key: destKey,
        CopySource: `/${bucket}/${sourceKey}`,
        CacheControl: opts?.cacheControl,
        ContentType: opts?.contentType,
        MetadataDirective: opts?.contentType || opts?.cacheControl ? "REPLACE" : undefined,
    }));
    return { key: destKey, url: cdnUrlForKey(destKey) };
}

export async function deleteObjectInS3(key: string): Promise<void> {
    const bucket = env.AWS_BUCKET_NAME!;
    await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

export async function objectExistsInS3(key: string): Promise<boolean> {
    const bucket = env.AWS_BUCKET_NAME!;
    try {
        await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return true;
    } catch {
        return false;
    }
}

async function resolveDownloadInputToBuffer(input: DownloadInput): Promise<Buffer> {
    if (typeof input === "string" || input instanceof URL) {
        const res = await fetch(input);
        if (!res.ok) throw new Error(`Failed to fetch: ${input}`);
        const ab = await res.arrayBuffer();
        return Buffer.from(ab);
    }
    if (input instanceof Response) {
        const ab = await input.arrayBuffer();
        return Buffer.from(ab);
    }
    if (input instanceof Blob) {
        const ab = await input.arrayBuffer();
        return Buffer.from(ab);
    }
    if (input instanceof Uint8Array) {
        return Buffer.from(input);
    }
    if (input instanceof ArrayBuffer) {
        return Buffer.from(input);
    }
    if ((input as ReadableStream<Uint8Array>)?.getReader) {
        const reader = (input as ReadableStream<Uint8Array>).getReader();
        const chunks: Uint8Array[] = [];
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
        }
        return Buffer.concat(chunks.map(c => Buffer.from(c)));
    }
    if ((input as Readable)?.pipe) {
        return new Promise<Buffer>((resolve, reject) => {
            const chunks: Buffer[] = [];
            (input as Readable)
                .on("data", (c: Buffer) => chunks.push(c))
                .on("end", () => resolve(Buffer.concat(chunks)))
                .on("error", reject);
        });
    }
    throw new Error("Unsupported DownloadInput type for S3 upload");
}
