# 🚨 원본 오디오 HLS 처리 최종 수정

## 문제점
1. ❌ 원본 오디오가 HLS 처리되지 않음
2. ❌ master.m3u8에 원본 트랙이 포함되지 않음
3. ❌ 비디오 HLS가 매번 재생성됨 (if (true) 조건)

## 수정 사항

### 1. dubbing.ts 수정 (약 75라인)

#### A. 원본 트랙 생성 추가
```typescript
// existingLangs와 newLangs 확인 후에 추가
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

### 2. 비디오 HLS 생성 조건 수정 (약 195라인)

**기존:**
```typescript
if (true) { // TEMP: Force regenerate video
```

**수정:**
```typescript
if (!await objectExistsInS3(videoM3u8Key)) {
```

### 3. 원본 오디오 HLS 처리 추가 (약 240라인)

**기존:**
```typescript
// Generate audio HLS for each language
for (const lang of body.targetLanguages) {
```

**수정:**
```typescript
// Generate audio HLS for origin (if not exists) and each target language
const languagesToProcess = [];

// Add origin if it doesn't exist in S3 yet
const originAudioM3u8Key = `${basePrefix}audio/origin/audio.m3u8`;
if (!await objectExistsInS3(originAudioM3u8Key)) {
    languagesToProcess.push("origin");
    console.log("[HLS] Origin audio will be processed");
} else {
    console.log("[HLS] Origin audio already exists in S3");
}

// Add target languages
languagesToProcess.push(...body.targetLanguages);

for (const lang of languagesToProcess) {
    const audioM3u8Key = `${basePrefix}audio/${lang}/audio.m3u8`;

    // Skip if already exists (except origin which we checked above)
    if (lang !== "origin" && await objectExistsInS3(audioM3u8Key)) {
        console.log(`[HLS] Audio for ${lang} already exists, skipping`);
        continue;
    }

    const track = await prisma.dubTrack.findUnique({
        where: { videoId_lang: { videoId: video.id, lang } }
    });

    if (!track?.url) {
        console.error(`[HLS] No track URL for ${lang}`);
        continue;
    }

    console.log(`[HLS] Generating audio HLS for ${lang}...`);
    const audioDir = path.join(tmpRoot, "audio", lang);
    await fs.mkdir(audioDir, { recursive: true });

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

    // Normalize and generate HLS (same for all)
    const aligned = path.join(audioDir, "aligned.wav");
    await execa("ffmpeg", [
        "-y",
        "-i", audioSource,
        "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
        "-ar", "48000",
        "-ac", "2",
        aligned
    ], { stdio: "inherit" });

    // Generate HLS segments
    await execa("ffmpeg", [
        "-y",
        "-i", aligned,
        "-c:a", "aac",
        "-b:a", "128k",
        "-ar", "48000",
        "-start_number", "0",
        "-hls_time", "4",
        "-hls_playlist_type", "vod",
        "-hls_segment_type", "fmp4",
        "-hls_fmp4_init_filename", "init.mp4",
        "-hls_flags", "independent_segments",
        "-hls_segment_filename", "a_%03d.m4s",
        "audio.m3u8"
    ], { stdio: "inherit", cwd: audioDir });

    console.log(`[HLS] Audio HLS for ${lang} generated`);
}
```

### 4. Master Playlist 생성 수정 (초기 생성 - 약 280라인)

```typescript
// Get all existing ready tracks for initial master playlist
const initialReadyTracks = await prisma.dubTrack.findMany({
    where: { videoId: video.id, status: "ready" },
    orderBy: { lang: 'asc' }
});

const initialAudioEntries = initialReadyTracks
    .sort((a, b) => {
        // Origin always comes first
        if (a.lang === "origin") return -1;
        if (b.lang === "origin") return 1;
        return a.lang.localeCompare(b.lang);
    })
    .map(track => ({
        lang: track.lang,
        name: track.lang === "origin" ? "ORIGIN" : track.lang,
        uri: `audio/${track.lang}/audio.m3u8`,
        groupId: "aud",
        defaultFlag: track.lang === "origin" // Origin is default
    }));

console.log("[HLS] Initial master playlist with existing tracks:", initialAudioEntries);

await upsertMasterPlaylist({
    masterPath,
    videoM3u8Rel: "video/video.m3u8",
    audioEntries: initialAudioEntries
});
```

### 5. Master Playlist 최종 생성 (약 340라인)

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
        name: track.lang === "origin" ? "ORIGIN" : track.lang,
        uri: `audio/${track.lang}/audio.m3u8`,
        groupId: "aud",
        defaultFlag: track.lang === "origin" // Origin is default
    }));
```

## 🔍 디버깅 체크리스트

1. **DB 확인:**
   ```sql
   SELECT * FROM "DubTrack" WHERE lang = 'origin' AND videoId = {videoId};
   ```

2. **S3 확인:**
   ```bash
   aws s3 ls s3://lingoost-origin/assets/curriculumsection/{id}/audio/origin/
   ```

3. **Master.m3u8 확인:**
   ```bash
   curl https://storage.lingoost.com/assets/curriculumsection/{id}/master.m3u8
   ```
   - NAME="ORIGIN"이 첫 번째 위치에 있는지
   - DEFAULT=YES로 설정되어 있는지
   - URI="audio/origin/audio.m3u8"이 올바른지

## 🎯 예상 결과

### Master.m3u8:
```m3u8
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ORIGIN",LANGUAGE="origin",AUTOSELECT=YES,DEFAULT=YES,URI="audio/origin/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ja",LANGUAGE="ja",AUTOSELECT=YES,DEFAULT=NO,URI="audio/ja/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="zh",LANGUAGE="zh",AUTOSELECT=YES,DEFAULT=NO,URI="audio/zh/audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="aud"
video/video.m3u8
```

## ⚠️ 중요 사항

1. **원본 트랙은 무조건 생성**: 더빙 요청 시 origin 트랙이 없으면 자동 생성
2. **원본 오디오는 비디오에서 추출**: `-vn` 옵션으로 오디오만 추출
3. **NAME은 영어로 "ORIGIN"**: 한글 "원본"이 아닌 영어 표시
4. **기본 선택 언어**: DEFAULT=YES로 원본이 기본값
5. **중복 처리 방지**: S3에 이미 있으면 재처리하지 않음