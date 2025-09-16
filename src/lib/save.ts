import fs from "node:fs";
import path from "node:path";
import type { Readable } from "node:stream";

export type DownloadInput = string | URL | Response | Blob | ArrayBuffer | Uint8Array | ReadableStream<Uint8Array> | Readable | { url: string };

function isNodeReadable(value: unknown): value is Readable {
    return typeof (value as { pipe?: unknown })?.pipe === "function";
}

function isWebReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
    return typeof (value as { getReader?: unknown })?.getReader === "function";
}

export async function saveUnknownToFile(result: DownloadInput, destPath: string): Promise<void> {
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
    if (isNodeReadable(result)) {
        await new Promise<void>((resolve, reject) => {
            const write = fs.createWriteStream(destPath);
            (result as Readable)
                .on("error", (err: unknown) => reject(err as Error))
                .pipe(write)
                .on("finish", () => resolve())
                .on("error", (err: unknown) => reject(err as Error));
        });
        return;
    }
    if (isWebReadableStream(result)) {
        const reader = (result as ReadableStream<Uint8Array>).getReader();
        const write = fs.createWriteStream(destPath);
        await new Promise<void>((resolve, reject) => {
            write.on("error", reject);
            (async () => {
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        if (value) write.write(Buffer.from(value));
                    }
                    write.end(() => resolve());
                } catch (err) {
                    reject(err);
                }
            })();
        });
        return;
    }
    if (typeof result === "string" || result instanceof URL) {
        const res = await fetch(result);
        if (!res.ok) throw new Error(`Failed to download from url: ${result}`);
        const ab = await res.arrayBuffer();
        await fs.promises.writeFile(destPath, Buffer.from(ab));
        return;
    }
    if (typeof (result as { url?: unknown })?.url === "string") {
        const res = await fetch((result as { url: string }).url);
        if (!res.ok) throw new Error(`Failed to download from url: ${(result as { url: string }).url}`);
        const ab = await res.arrayBuffer();
        await fs.promises.writeFile(destPath, Buffer.from(ab));
        return;
    }
    if (result instanceof Response) {
        const ab = await result.arrayBuffer();
        await fs.promises.writeFile(destPath, Buffer.from(ab));
        return;
    }
    if (result instanceof Blob) {
        const arrayBuffer = await result.arrayBuffer();
        await fs.promises.writeFile(destPath, Buffer.from(arrayBuffer));
        return;
    }
    if (result instanceof Uint8Array || result instanceof ArrayBuffer) {
        const buf = result instanceof ArrayBuffer ? Buffer.from(result) : Buffer.from(result as Uint8Array);
        await fs.promises.writeFile(destPath, buf);
        return;
    }
    throw new Error("Unsupported download result type for saving to file");
}


