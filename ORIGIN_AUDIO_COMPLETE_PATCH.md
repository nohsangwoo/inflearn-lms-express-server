# 🎯 Complete Origin Audio HLS Implementation Patch

## Implementation Summary
This patch adds complete origin audio support with HLS streaming, using language code "origin" and displaying as "ORIGIN" in English.

## 📁 Files to Modify

### 1. `/expressserver/src/routes/dubbing.ts`

#### A. Add Origin Track Creation (After line 70, before processing new languages)

```typescript
// Around line 75, after checking existingLangs
// ADD THIS BLOCK:

// Check if origin track exists and create if needed
const hasOriginTrack = existingLangs.includes("origin");
if (!hasOriginTrack) {
    console.log("[Dubbing] Creating origin audio track in database...");
    const originalUrl = body.inputVideoUrl || body.inputVideoPath || video.videoUrl;

    await prisma.dubTrack.create({
        data: {
            videoId: video.id,
            lang: "origin",
            status: "ready",
            url: originalUrl,
            updatedAt: new Date()
        }
    });
    console.log("[Dubbing] Origin track created");
}
```

#### B. Include Origin in HLS Processing (Around line 240)

**REPLACE:**
```typescript
// Generate audio HLS for each language
for (const lang of body.targetLanguages) {
```

**WITH:**
```typescript
// Generate audio HLS for origin (if not exists) and each target language
const languagesToProcess = [];

// Add origin if it doesn't exist in S3 yet
const originAudioM3u8Key = `${basePrefix}audio/origin/audio.m3u8`;
if (!await objectExistsInS3(originAudioM3u8Key)) {
    languagesToProcess.push("origin");
    console.log("[HLS] Origin audio will be processed");
}

// Add target languages
languagesToProcess.push(...body.targetLanguages);

for (const lang of languagesToProcess) {
```

#### C. Add Origin Audio Extraction Logic (Inside the HLS loop, around line 260)

**AFTER:**
```typescript
const audioDir = path.join(tmpRoot, "audio", lang);
await fs.mkdir(audioDir, { recursive: true });
```

**ADD:**
```typescript
let audioSource = path.join(audioDir, "source.wav");

if (lang === "origin") {
    // Extract audio from original video
    console.log(`[HLS] Extracting audio from original video for origin track...`);
    await execa("ffmpeg", [
        "-y",
        "-i", track.url,
        "-vn", // No video
        "-acodec", "pcm_s16le",
        "-ar", "48000",
        "-ac", "2",
        audioSource
    ], { stdio: "inherit" });
    console.log(`[HLS] Original audio extracted`);
} else {
    // For dubbed languages, convert to WAV
    await execa("ffmpeg", [
        "-y",
        "-i", track.url,
        "-acodec", "pcm_s16le",
        "-ar", "48000",
        "-ac", "2",
        audioSource
    ], { stdio: "inherit" });
}

// Then continue with normalization using audioSource
const aligned = path.join(audioDir, "aligned.wav");
await execa("ffmpeg", [
    "-y",
    "-i", audioSource,
    "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
    "-ar", "48000",
    "-ac", "2",
    aligned
], { stdio: "inherit" });
```

#### D. Update Master Playlist Generation (Around line 340)

**REPLACE:**
```typescript
const finalAudioEntries = allFinalTracks.map(track => ({
    lang: track.lang,
    name: track.lang,
    uri: `audio/${track.lang}/audio.m3u8`,
    groupId: "aud",
    defaultFlag: track.lang === "ja" || track.lang === "ko"
}));
```

**WITH:**
```typescript
const finalAudioEntries = allFinalTracks
    .sort((a, b) => {
        // Origin always comes first
        if (a.lang === "origin") return -1;
        if (b.lang === "origin") return 1;
        return a.lang.localeCompare(b.lang);
    })
    .map(track => ({
        lang: track.lang,
        name: track.lang === "origin" ? "ORIGIN" : track.lang,  // ⚠️ IMPORTANT: Use "ORIGIN" in English
        uri: `audio/${track.lang}/audio.m3u8`,
        groupId: "aud",
        defaultFlag: track.lang === "origin"  // Origin is default
    }));
```

### 2. `/inflearn-clone/src/components/video/shaka-player-modal.tsx`

#### Add origin to language name mapping:

```typescript
const langNameMap: Record<string, string> = {
  origin: "ORIGIN",  // Add this line
  ko: "한국어",
  en: "영어",
  ja: "일본어",
  zh: "중국어",
  es: "스페인어",
  fr: "프랑스어",
  de: "독일어",
  ru: "러시아어",
  ar: "아랍어",
  hi: "힌디어",
  pt: "포르투갈어",
  id: "인도네시아어",
  tr: "터키어",
  it: "이탈리아어",
  vi: "베트남어",
  th: "태국어",
  pl: "폴란드어",
  nl: "네덜란드어",
  sv: "스웨덴어",
  fi: "핀란드어",
}
```

### 3. `/inflearn-clone/src/components/video/hls-player-modal.tsx`

#### Same update as shaka-player-modal.tsx:

```typescript
const langNameMap: Record<string, string> = {
  origin: "ORIGIN",  // Add this line
  // ... rest of languages
}
```

## 📊 Expected Results

### Master.m3u8 Format:
```m3u8
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ORIGIN",LANGUAGE="origin",AUTOSELECT=YES,DEFAULT=YES,URI="audio/origin/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",LANGUAGE="en",AUTOSELECT=YES,DEFAULT=NO,URI="audio/en/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ja",LANGUAGE="ja",AUTOSELECT=YES,DEFAULT=NO,URI="audio/ja/audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="aud"
video/video.m3u8
```

### S3 Structure:
```
assets/curriculumsection/{id}/
├── master.m3u8
├── video/
│   ├── video.m3u8
│   ├── init.mp4
│   └── v_*.m4s
└── audio/
    ├── origin/           ← New!
    │   ├── audio.m3u8
    │   ├── init.mp4
    │   └── a_*.m4s
    ├── ja/
    ├── zh/
    └── en/
```

### Database:
```sql
-- New DubTrack record
{
  videoId: {video.id},
  lang: "origin",
  status: "ready",
  url: {original_video_url}
}
```

## ✅ Key Features

1. **Origin Track Creation**: Automatically creates origin track in DB when dubbing starts
2. **Audio Extraction**: Extracts audio from original video using `ffmpeg -vn`
3. **HLS Processing**: Processes origin audio through same pipeline as dubbed audio
4. **Playlist Ordering**: Origin always appears first with DEFAULT=YES
5. **English Naming**: NAME field shows "ORIGIN" in English, not Korean
6. **Caching**: Origin audio only processed once, reused for subsequent requests

## 🚀 Implementation Steps

1. Apply changes to `dubbing.ts` following sections A-D above
2. Update frontend player components with origin language mapping
3. Test with a new dubbing request
4. Verify master.m3u8 contains origin track with NAME="ORIGIN"
5. Check S3 for audio/origin/ folder with HLS segments

## 🔍 Verification

Run these checks after implementation:

```bash
# 1. Check DB for origin track
SELECT * FROM "DubTrack" WHERE lang = 'origin';

# 2. Check S3 for origin audio
aws s3 ls s3://lingoost-origin/assets/curriculumsection/{id}/audio/origin/

# 3. Verify master.m3u8 contains ORIGIN
curl https://storage.lingoost.com/assets/curriculumsection/{id}/master.m3u8 | grep ORIGIN
```

## ⚠️ Important Notes

- Origin audio is extracted from the original video file, not a dubbed version
- The NAME field must be "ORIGIN" in English, not "원본" in Korean
- Origin track should always be the default (DEFAULT=YES)
- Origin should always appear first in the playlist
- Process origin only if it doesn't already exist in S3 (avoid reprocessing)