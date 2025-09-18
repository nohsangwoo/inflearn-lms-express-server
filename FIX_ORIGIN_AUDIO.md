# 🚨 원본 오디오 추가 수정 사항

## 1️⃣ 원본 트랙 DB 생성 (약 86라인 근처, 더빙 처리 전에 추가)

```typescript
const results: Array<{ lang: string; url: string }> = [];

// 🆕 원본 트랙 생성 코드 추가
const hasOriginTrack = video.DubTrack.some(t => t.lang === "origin");
if (!hasOriginTrack) {
    console.log("[Dubbing] Creating origin audio track in DB...");
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

// 2) Process each language separately
for (const lang of newLangs) {
```

## 2️⃣ 오디오 HLS 생성 부분 수정 (약 214라인)

**기존 코드:**
```typescript
// Generate audio HLS for each language
for (const lang of body.targetLanguages) {
```

**수정 코드:**
```typescript
// Generate audio HLS for origin + each language
const allLanguagesToProcess = [];

// Add origin if not exists in S3
const originAudioM3u8Key = `${basePrefix}audio/origin/audio.m3u8`;
if (!await objectExistsInS3(originAudioM3u8Key)) {
    allLanguagesToProcess.push("origin");
    console.log("[HLS] Origin audio will be processed");
}

// Add target languages
allLanguagesToProcess.push(...body.targetLanguages);

for (const lang of allLanguagesToProcess) {
    const audioM3u8Key = `${basePrefix}audio/${lang}/audio.m3u8`;

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

    // 🆕 원본 오디오 처리 분기
    let audioSource = path.join(audioDir, "source.wav");

    if (lang === "origin") {
        // Extract audio from video
        console.log("[HLS] Extracting audio from original video...");
        await execa("ffmpeg", [
            "-y",
            "-i", track.url,
            "-vn",  // No video
            "-acodec", "pcm_s16le",
            "-ar", "48000",
            "-ac", "2",
            audioSource
        ], { stdio: "inherit" });
    } else {
        // Convert dubbed audio
        await execa("ffmpeg", [
            "-y",
            "-i", track.url,
            "-acodec", "pcm_s16le",
            "-ar", "48000",
            "-ac", "2",
            audioSource
        ], { stdio: "inherit" });
    }

    // Normalize audio
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

## 3️⃣ Master Playlist 생성 수정 (약 280라인)

**기존 코드:**
```typescript
const finalAudioEntries = allFinalTracks.map(track => ({
    lang: track.lang,
    name: track.lang,  // ❌ 이래서 "origin"으로 표시됨
    uri: `audio/${track.lang}/audio.m3u8`,
    groupId: "aud",
    defaultFlag: track.lang === "ja" || track.lang === "ko"
}));
```

**수정 코드:**
```typescript
const finalAudioEntries = allFinalTracks
    .sort((a, b) => {
        // 원본이 항상 첫 번째
        if (a.lang === "origin") return -1;
        if (b.lang === "origin") return 1;
        return a.lang.localeCompare(b.lang);
    })
    .map(track => ({
        lang: track.lang,
        name: track.lang === "origin" ? "원본" : track.lang,  // ✅ 원본은 "원본"으로 표시
        uri: `audio/${track.lang}/audio.m3u8`,
        groupId: "aud",
        defaultFlag: track.lang === "origin"  // ✅ 원본이 기본값
    }));
```

## 📁 최종 master.m3u8 예상 결과

```m3u8
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="원본",LANGUAGE="origin",AUTOSELECT=YES,DEFAULT=YES,URI="audio/origin/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",LANGUAGE="en",AUTOSELECT=YES,DEFAULT=NO,URI="audio/en/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ja",LANGUAGE="ja",AUTOSELECT=YES,DEFAULT=NO,URI="audio/ja/audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="aud"
video/video.m3u8
```

## ⚠️ 중요 체크 포인트

1. **원본 DubTrack이 DB에 생성되는지 확인**
   ```sql
   SELECT * FROM "DubTrack" WHERE lang = 'origin';
   ```

2. **S3에 원본 오디오 폴더가 생성되는지 확인**
   - `assets/curriculumsection/{id}/audio/origin/audio.m3u8`
   - `assets/curriculumsection/{id}/audio/origin/init.mp4`
   - `assets/curriculumsection/{id}/audio/origin/a_*.m4s`

3. **Master.m3u8에 원본이 포함되는지 확인**
   - NAME="원본" (한글로)
   - DEFAULT=YES
   - 첫 번째 위치

## 🔧 적용 방법

1. `dubbing.ts` 파일을 위 3개 부분 수정
2. Express 서버 재시작
3. 새로운 더빙 요청 테스트
4. master.m3u8 확인