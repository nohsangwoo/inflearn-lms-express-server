좋아. Cursor에 그대로 붙여넣어 실행 지시하기 좋은 **개발 프롬프트**를 아래에 정리했어. (Next.js + TypeScript + S3/CloudFront + ffmpeg + hls.js 전제)

---

# 🧩 Task: Implement HLS “alternate audio” pipeline for dubbed lessons

## Context

* We already generate dubbed audio via **ElevenLabs API** per language.
* Store **one master video** per lesson and **multiple audio tracks** (ko/en/ja/…).
* On the web/app player, switching language must **swap only the audio** instantly while the video keeps playing.
* We will distribute over **S3 + CloudFront** with **HLS (CMAF/fMP4)**.

## Goals

1. **Server-side packaging**

   * Create/maintain HLS outputs:

     * `/video/video.m3u8` (+ `v_***.m4s`) for the shared video
     * `/audio/{lang}/audio.m3u8` (+ `a_***.m4s`) per language
     * `master.m3u8` referencing all audio tracks via `EXT-X-MEDIA` (GROUP-ID="aud")
2. **S3 upload** with correct `Content-Type` and `Cache-Control`.
3. **CloudFront** path invalidation for `master.m3u8` after adding a language.
4. **Frontend player** (React/Next.js) using `hls.js` to list/select audio tracks and switch instantly.
5. Minimal **APIs/CLI** to (a) package video once, (b) add language audio, (c) query tracks.
6. Keep **sync quality**: resample to 48kHz, loudness normalize (-16 LUFS), optional offset ms.

## Tech constraints

* Repo: Next.js (App Router), TypeScript.
* Use `ffmpeg` (assume available in PATH).
* Use AWS SDK v3.
* Env vars:

  ```
  AWS_REGION=
  AWS_ACCESS_KEY_ID=
  AWS_SECRET_ACCESS_KEY=
  AWS_S3_BUCKET=
  CLOUDFRONT_DISTRIBUTION_ID=
  CDN_BASE_URL=https://cdn.example.com    # CloudFront domain
  ```
* HLS settings:

  * segment duration: 4s (OK to tune 2\~4s)
  * video codec: H.264 (baseline/main acceptable); audio: AAC 128k
  * fMP4 segments (`-hls_segment_type fmp4`, CMAF)
  * keyframe interval = 48 (for 12 fps\*? adjust to your frame rate; target \~2×segment)

## Directory layout (S3)

```
/assets/{videoId}/
  master.m3u8
  /video/video.m3u8
  /video/v_000.m4s ...
  /audio/ko/audio.m3u8
  /audio/ko/a_000.m4s ...
  /audio/en/audio.m3u8
  /audio/en/a_000.m4s ...
```

---

## Implement

### 1) Media packaging scripts

Create `scripts/pack-hls.ts` — package **video-only HLS** (run once per video):

```ts
// scripts/pack-hls.ts
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { uploadDirToS3 } from "../src/lib/aws/s3-upload";
import { ensureMimeMeta } from "../src/lib/aws/mime";
import { upsertMasterPlaylist } from "../src/lib/media/hls-master";

const SEG_DUR = 4;

async function main() {
  const videoId = process.argv[2]; // e.g., "VID123"
  const inputMp4 = process.argv[3]; // local path to master.mp4
  if (!videoId || !inputMp4) {
    console.error("Usage: tsx scripts/pack-hls.ts <videoId> <path/to/master.mp4>");
    process.exit(1);
  }

  const outDir = path.resolve(".tmp", videoId);
  const videoDir = path.join(outDir, "video");
  await fs.mkdir(videoDir, { recursive: true });

  // 1) HLS (video only)
  await execa("ffmpeg", [
    "-y",
    "-i", inputMp4,
    "-map", "0:v:0",
    "-c:v", "libx264",
    "-profile:v", "main",
    "-level", "4.1",
    "-preset", "veryfast",
    "-crf", "20",
    "-x264-params", "keyint=48:min-keyint=48:scenecut=0",
    "-start_number", "0",
    "-hls_time", String(SEG_DUR),
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4",
    "-hls_flags", "independent_segments",
    "-hls_segment_filename", path.join(videoDir, "v_%03d.m4s"),
    path.join(videoDir, "video.m3u8"),
  ], { stdio: "inherit" });

  // 2) create initial master.m3u8 if missing (no audio yet)
  const masterPath = path.join(outDir, "master.m3u8");
  await upsertMasterPlaylist({
    masterPath,
    videoM3u8Rel: "video/video.m3u8",
    // audioEntries can be empty at first
    audioEntries: [],
  });

  // 3) Upload to S3 under /assets/{videoId}/
  await uploadDirToS3(outDir, `assets/${videoId}/`, ensureMimeMeta);

  console.log("DONE: video packaged and uploaded. master.m3u8 ready for audio additions.");
}

main().catch((e) => { console.error(e); process.exit(1); });
```

Create `scripts/add-audio.ts` — add **one language** audio (takes a WAV/MP3 from ElevenLabs output, will align/normalize, HLS it, patch master, upload, invalidate):

```ts
// scripts/add-audio.ts
import { execa } from "execa";
import path from "node:path";
import fs from "node:fs/promises";
import { uploadDirToS3 } from "../src/lib/aws/s3-upload";
import { ensureMimeMeta } from "../src/lib/aws/mime";
import { patchMasterAddAudio, invalidateMaster } from "../src/lib/media/hls-master";

const SEG_DUR = 4;

// optional: -16 LUFS normalization; offset_ms if you store it in DB
async function normalizeAndAlign(input: string, outWav: string, offsetMs = 0) {
  const af: string[] = [];
  // loudness
  af.push(`loudnorm=I=-16:LRA=11:TP=-1.5`);
  // alignment padding if needed
  if (offsetMs > 0) af.push(`adelay=${offsetMs}|${offsetMs}`);

  const filter = af.join(",");
  await execa("ffmpeg", [
    "-y",
    "-i", input,
    "-af", filter,
    "-ar", "48000",
    "-ac", "2",
    outWav
  ], { stdio: "inherit" });
}

async function main() {
  const videoId = process.argv[2]; // "VID123"
  const lang = process.argv[3];    // "ko", "en", ...
  const inputAudio = process.argv[4]; // path to dubbing audio
  if (!videoId || !lang || !inputAudio) {
    console.error("Usage: tsx scripts/add-audio.ts <videoId> <lang> <path/to/dub.wav|mp3>");
    process.exit(1);
  }

  const tmp = path.resolve(".tmp", videoId, "audio", lang);
  await fs.mkdir(tmp, { recursive: true });

  const aligned = path.join(tmp, "aligned.wav");
  await normalizeAndAlign(inputAudio, aligned, 0);

  // HLS (audio only)
  await execa("ffmpeg", [
    "-y",
    "-i", aligned,
    "-c:a", "aac",
    "-b:a", "128k",
    "-ar", "48000",
    "-start_number", "0",
    "-hls_time", String(SEG_DUR),
    "-hls_playlist_type", "vod",
    "-hls_segment_type", "fmp4",
    "-hls_flags", "independent_segments",
    "-hls_segment_filename", path.join(tmp, "a_%03d.m4s"),
    path.join(tmp, "audio.m3u8"),
  ], { stdio: "inherit" });

  // patch master.m3u8
  const outRoot = path.resolve(".tmp", videoId);
  const masterPath = path.join(outRoot, "master.m3u8");
  await patchMasterAddAudio({
    masterPath,
    lang,
    name: langToName(lang),
    uri: `audio/${lang}/audio.m3u8`,
    groupId: "aud",
    defaultFlag: (lang === "ko") // tweak default rule
  });

  // upload audio dir + master
  await uploadDirToS3(outRoot, `assets/${videoId}/`, ensureMimeMeta);

  // invalidate master.m3u8 on CloudFront
  await invalidateMaster(`assets/${videoId}/master.m3u8`);

  console.log(`DONE: added audio lang=${lang} for videoId=${videoId}`);
}

function langToName(lang: string) {
  const m: Record<string,string> = { ko: "Korean", en: "English", ja: "Japanese" };
  return m[lang] ?? lang;
}

main().catch((e) => { console.error(e); process.exit(1); });
```

### 2) HLS master playlist helpers

```ts
// src/lib/media/hls-master.ts
import fs from "node:fs/promises";
import { createInvalidation } from "../aws/cf";

type AudioEntry = { lang: string; name: string; uri: string; groupId: string; defaultFlag?: boolean; };

export async function upsertMasterPlaylist(params: {
  masterPath: string;
  videoM3u8Rel: string; // e.g., "video/video.m3u8"
  audioEntries: AudioEntry[];
}) {
  let content = "";
  try { content = await fs.readFile(params.masterPath, "utf8"); } catch {}
  if (!content) {
    content = "#EXTM3U\n";
  }

  // remove existing MEDIA lines + STREAM-INF lines to rebuild (idempotent)
  const lines = content.split("\n").filter(l => !l.startsWith("#EXT-X-MEDIA") && !l.startsWith("#EXT-X-STREAM-INF"));
  let out = lines.join("\n").trim() + "\n";

  // add audio media descriptors
  for (const a of params.audioEntries) {
    out += mediaLine(a) + "\n";
  }

  // add video stream referencing audio group
  out += `#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.4d401f",RESOLUTION=1920x1080,AUDIO="aud"\n`;
  out += params.videoM3u8Rel + "\n";

  await fs.writeFile(params.masterPath, out, "utf8");
}

export async function patchMasterAddAudio(a: AudioEntry & { masterPath: string }) {
  const { masterPath, ...entry } = a;
  let content = await fs.readFile(masterPath, "utf8");
  // if already exists (lang duplicate), replace it; else append before first STREAM-INF
  const media = mediaLine(entry);
  const lines = content.split("\n");
  const has = lines.some(l => l.includes(`LANGUAGE="${entry.lang}"`) || l.includes(`NAME="${entry.name}"`));
  if (!has) {
    const idx = lines.findIndex(l => l.startsWith("#EXT-X-STREAM-INF"));
    if (idx === -1) lines.push(media);
    else lines.splice(idx, 0, media);
    content = lines.join("\n");
    await fs.writeFile(masterPath, content, "utf8");
  }
}

function mediaLine(a: AudioEntry) {
  const def = a.defaultFlag ? "YES" : "NO";
  return `#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="${a.groupId}",NAME="${a.name}",LANGUAGE="${a.lang}",AUTOSELECT=YES,DEFAULT=${def},URI="${a.uri}"`;
}

export async function invalidateMaster(masterKey: string) {
  // masterKey example: 'assets/VID123/master.m3u8'
  await createInvalidation([`/${masterKey}`]);
}
```

### 3) AWS helpers (S3 upload, CloudFront invalidation, MIME map)

```ts
// src/lib/aws/mime.ts
export function ensureMimeMeta(key: string): { ContentType?: string; CacheControl?: string } {
  const lower = key.toLowerCase();
  if (lower.endsWith(".m3u8")) return { ContentType: "application/vnd.apple.mpegurl", CacheControl: "public, max-age=60" };
  if (lower.endsWith(".m4s"))  return { ContentType: "video/iso.segment", CacheControl: "public, max-age=31536000, immutable" };
  if (lower.endsWith(".ts"))   return { ContentType: "video/mp2t", CacheControl: "public, max-age=31536000, immutable" };
  if (lower.endsWith(".mpd"))  return { ContentType: "application/dash+xml", CacheControl: "public, max-age=60" };
  if (lower.endsWith(".mp4"))  return { ContentType: "video/mp4", CacheControl: "public, max-age=31536000, immutable" };
  if (lower.endsWith(".mp3"))  return { ContentType: "audio/mpeg", CacheControl: "public, max-age=31536000, immutable" };
  if (lower.endsWith(".wav"))  return { ContentType: "audio/wav", CacheControl: "public, max-age=31536000, immutable" };
  return {};
}
```

```ts
// src/lib/aws/s3-upload.ts
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import fs from "node:fs/promises";
import path from "node:path";

const s3 = new S3Client({ region: process.env.AWS_REGION });

export async function uploadDirToS3(localDir: string, prefix: string, meta: (key: string)=>({ContentType?: string; CacheControl?: string})) {
  const files = await walk(localDir);
  for (const f of files) {
    const key = prefix + path.relative(localDir, f).replace(/\\/g, "/");
    const extra = meta(key);
    const Body = await fs.readFile(f);
    await s3.send(new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET!,
      Key: key,
      Body,
      ...extra,
    }));
    // console.log("uploaded", key, extra);
  }
}

async function walk(dir: string, acc: string[] = []): Promise<string[]> {
  for (const ent of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) await walk(p, acc);
    else acc.push(p);
  }
  return acc;
}
```

```ts
// src/lib/aws/cf.ts
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
const cf = new CloudFrontClient({ region: process.env.AWS_REGION });

export async function createInvalidation(paths: string[]) {
  const CallerReference = `${Date.now()}-${Math.random()}`;
  await cf.send(new CreateInvalidationCommand({
    DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID!,
    InvalidationBatch: { CallerReference, Paths: { Quantity: paths.length, Items: paths } }
  }));
}
```

### 4) Frontend player (hls.js)

Create `src/components/VideoPlayer.tsx`:

```tsx
"use client";
import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type Props = { src: string; initialLang?: string; onTracks?: (tracks: {lang:string; name:string; index:number}[]) => void };

export default function VideoPlayer({ src, initialLang, onTracks }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hls, setHls] = useState<Hls | null>(null);
  const [tracks, setTracks] = useState<{lang:string; name:string; index:number}[]>([]);
  const [curIdx, setCurIdx] = useState<number>(-1);

  useEffect(() => {
    const video = videoRef.current!;
    if (Hls.isSupported()) {
      const _hls = new Hls({ enableWorker: true });
      _hls.loadSource(src);
      _hls.attachMedia(video);
      _hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const list = _hls.audioTracks.map((t, i) => ({ lang: t.lang ?? String(i), name: t.name ?? t.lang ?? String(i), index: i }));
        setTracks(list);
        onTracks?.(list);
        if (initialLang) {
          const idx = list.findIndex(t => t.lang === initialLang);
          if (idx >= 0) { _hls.audioTrack = idx; setCurIdx(idx); }
        } else if (_hls.audioTracks.length) {
          setCurIdx(_hls.audioTrack);
        }
      });
      setHls(_hls);
      return () => { _hls.destroy(); };
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = src; // Safari/iOS native HLS
    }
  }, [src, initialLang, onTracks]);

  const setLang = (lang: string) => {
    if (!hls) return;
    const idx = tracks.findIndex(t => t.lang === lang);
    if (idx >= 0) { hls.audioTrack = idx; setCurIdx(idx); localStorage.setItem("lesson_lang", lang); }
  };

  return (
    <div className="w-full space-y-2">
      <video ref={videoRef} controls playsInline className="w-full rounded-2xl shadow" />
      {tracks.length > 0 && (
        <div className="flex gap-2 flex-wrap">
          {tracks.map(t => (
            <button key={t.index}
              onClick={() => setLang(t.lang)}
              className={`px-3 py-1 rounded-full border ${t.index===curIdx ? "bg-black text-white" : "bg-white"}`}>
              {t.name} ({t.lang})
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

Usage:

```tsx
// e.g., app/lesson/[id]/page.tsx
import VideoPlayer from "@/components/VideoPlayer";

export default function Page({ params }: { params: { id: string } }) {
  const masterUrl = `${process.env.NEXT_PUBLIC_CDN_BASE_URL}/assets/${params.id}/master.m3u8`;
  const lang = typeof window !== "undefined" ? localStorage.getItem("lesson_lang") ?? undefined : undefined;

  return <VideoPlayer src={masterUrl} initialLang={lang} />;
}
```

### 5) Minimal API endpoints (optional)

* `POST /api/media/:videoId/add-language` with body `{ lang: "en", audioUrl: "s3://.../dub.wav" }`

  * Downloads the file to temp, runs `normalizeAndAlign`, packages HLS, uploads, invalidates, updates DB.

*(For brevity, you can directly shell out to the `scripts/add-audio.ts` from the API route using a worker/queue in your environment.)*

### 6) Data model (example)

If you’re on Prisma:

```prisma
model Video {
  id           String   @id
  title        String
  durationMs   Int
  masterKey    String   // s3 key: assets/{id}/master.m3u8
  createdAt    DateTime @default(now())
  DubTrack     DubTrack[]
}

model DubTrack {
  id         String   @id @default(cuid())
  videoId    String
  lang       String
  status     String   // queued|processing|ready|failed
  lufs       Float?
  offsetMs   Int?     // sync compensation
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  Video      Video    @relation(fields: [videoId], references: [id])
  @@unique([videoId, lang])
}
```

---

## Acceptance criteria

* [ ] Given a raw `master.mp4`, `tsx scripts/pack-hls.ts VID123 ./master.mp4` produces & uploads:

  * `assets/VID123/video/video.m3u8` + `v_***.m4s`
  * `assets/VID123/master.m3u8` (with one `#EXT-X-STREAM-INF` referencing AUDIO group `"aud"`)
* [ ] Given a dubbed audio file (wav/mp3), `tsx scripts/add-audio.ts VID123 en ./en.wav`:

  * normalizes to -16 LUFS, 48kHz, HLS packages to `assets/VID123/audio/en/`
  * patches `master.m3u8` with `#EXT-X-MEDIA: TYPE=AUDIO, GROUP-ID="aud", LANGUAGE="en", URI="audio/en/audio.m3u8"`
  * CloudFront invalidation for `/assets/VID123/master.m3u8`
* [ ] Frontend `VideoPlayer` lists audio tracks and switches instantly without reloading the video.
* [ ] S3 objects have correct `Content-Type` and `Cache-Control` (m3u8 short TTL; segments immutable).
* [ ] CORS/Range requests OK via CloudFront (assume Response Headers Policy set outside code).

---

## Notes & edge cases

* If ElevenLabs outputs include leading/trailing silence causing drift, use `offsetMs` per track (store in DB) and apply in `normalizeAndAlign`.
* If you already have segmented video (e.g., ABR ladders), update `upsertMasterPlaylist` to emit multiple `#EXT-X-STREAM-INF` lines; all must reference the same `AUDIO="aud"`.
* For content protection, integrate **signed URLs/cookies** at CloudFront; no change in player code.
* If Safari-only environment, native HLS works; we keep `hls.js` for cross-browser reliability.

---

**Done.** 이 프롬프트를 Cursor에 붙여넣으면, 바로 코드/파일 생성과 연결부 구현을 진행해줄 거야. 필요하면 Terraform/CloudFormation용 OAC+Origin/Behavior 설정 스니펫도 이어서 뽑아줄게.
