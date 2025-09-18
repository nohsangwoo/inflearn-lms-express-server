# 원본 오디오 완전 HLS 처리 패치

## 🎯 핵심 변경사항

### 1. 원본 트랙 DB 생성 (더빙 요청 시작 부분)

```typescript
// Check if origin track exists
const hasOriginTrack = existingLangs.includes("origin");
if (!hasOriginTrack) {
    console.log("[Dubbing] Origin track doesn't exist, will create it");

    // Create origin track in database
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
    console.log("[Dubbing] Origin track created in database");
}
```

### 2. 원본 오디오 HLS 처리 (약 220라인)

```typescript
// Generate audio HLS for origin (if not exists) and each target language
const languagesToProcess = [];

// Add origin if it doesn't exist in S3 yet
const originAudioM3u8Key = `${basePrefix}audio/origin/audio.m3u8`;
if (!await objectExistsInS3(originAudioM3u8Key)) {
    languagesToProcess.push("origin");
}

// Add target languages
languagesToProcess.push(...body.targetLanguages);

for (const lang of languagesToProcess) {
    const audioM3u8Key = `${basePrefix}audio/${lang}/audio.m3u8`;

    // Skip if already exists (except origin)
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
        // For dubbed languages, process normally
        await execa("ffmpeg", [
            "-y",
            "-i", track.url,
            "-acodec", "pcm_s16le",
            "-ar", "48000",
            "-ac", "2",
            audioSource
        ], { stdio: "inherit" });
    }

    // Normalize audio (same for all languages including origin)
    const aligned = path.join(audioDir, "aligned.wav");
    await execa("ffmpeg", [
        "-y",
        "-i", audioSource,
        "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
        "-ar", "48000",
        "-ac", "2",
        aligned
    ], { stdio: "inherit" });

    // Generate HLS segments (same for all languages including origin)
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

### 3. Master Playlist 정렬 (원본이 첫 번째)

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
        name: track.lang === "origin" ? "원본" : track.lang,
        uri: `audio/${track.lang}/audio.m3u8`,
        groupId: "aud",
        defaultFlag: track.lang === "origin" // Origin is default
    }));
```

## 📁 최종 S3 구조

```
assets/curriculumsection/{sectionId}/
├── master.m3u8
├── video/
│   ├── video.m3u8
│   ├── init.mp4
│   └── v_*.m4s
└── audio/
    ├── origin/           # 원본 오디오 (새로 추가)
    │   ├── audio.m3u8
    │   ├── init.mp4
    │   └── a_*.m4s
    ├── ja/
    │   ├── audio.m3u8
    │   ├── init.mp4
    │   └── a_*.m4s
    ├── zh/
    │   ├── audio.m3u8
    │   ├── init.mp4
    │   └── a_*.m4s
    └── en/
        ├── audio.m3u8
        ├── init.mp4
        └── a_*.m4s
```

## 🎯 처리 흐름

1. **더빙 요청 시작**
   - Origin DubTrack이 없으면 DB에 생성
   - 원본 비디오 URL을 참조

2. **HLS 변환 단계**
   - Origin이 S3에 없으면 처리 목록에 추가
   - 원본 비디오에서 오디오 추출 (`-vn` 옵션)
   - 추출된 오디오를 정규화 (loudnorm)
   - HLS 세그먼트 생성 (init.mp4 + m4s 파일들)

3. **S3 업로드**
   - `audio/origin/` 경로에 업로드
   - 다른 더빙 언어와 동일한 구조

4. **Master Playlist**
   - Origin이 항상 첫 번째
   - DEFAULT=YES로 설정
   - NAME="원본"으로 표시

## ✅ 결과

- 원본 오디오가 완전히 HLS로 변환되어 S3에 저장
- 다른 더빙 언어와 동일한 경로 구조 (`audio/origin/`)
- 언어 선택에서 "원본"이 첫 번째 기본 옵션
- 한 번 생성하면 재사용 (중복 처리 방지)