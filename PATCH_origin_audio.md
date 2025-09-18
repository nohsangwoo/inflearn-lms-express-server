# 원본 오디오 HLS 처리 패치

## 📋 수정 내용

### 1. dubbing.ts - 원본 오디오 처리 추가 (약 87라인 근처)

**원본 오디오 트랙 생성 (더빙 처리 전에 추가)**
```typescript
// 2) Process original audio first (if not exists)
const originTrack = await prisma.dubTrack.findUnique({
    where: { videoId_lang: { videoId: video.id, lang: "origin" } }
});

if (!originTrack) {
    console.log("[Dubbing] Creating origin audio track...");
    const originalUrl = body.inputVideoUrl || body.inputVideoPath || video.videoUrl;

    // Save origin track to database
    await prisma.dubTrack.create({
        data: {
            videoId: video.id,
            lang: "origin",
            status: "ready",
            url: originalUrl,
            updatedAt: new Date()
        }
    });

    console.log("[Dubbing] Origin audio track created in database");
} else {
    console.log("[Dubbing] Origin audio track already exists");
}

// 3) Process each dubbing language separately
for (const lang of newLangs) {
    // ... 기존 더빙 처리 로직
}
```

### 2. HLS 오디오 생성 부분 수정 (약 215라인 근처)

**원본 오디오도 HLS로 변환하도록 수정**
```typescript
// Generate audio HLS for each language (including origin)
const allLanguagesToProcess = ["origin", ...body.targetLanguages];

for (const lang of allLanguagesToProcess) {
    const audioM3u8Key = `${basePrefix}audio/${lang}/audio.m3u8`;

    if (await objectExistsInS3(audioM3u8Key)) {
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

    // For origin, extract audio from video
    if (lang === "origin") {
        // Extract audio from original video
        await execa("ffmpeg", [
            "-y",
            "-i", track.url,
            "-vn",  // No video
            "-acodec", "pcm_s16le",
            "-ar", "48000",
            "-ac", "2",
            path.join(audioDir, "origin.wav")
        ], { stdio: "inherit" });

        // Then process as normal
        const aligned = path.join(audioDir, "aligned.wav");
        await execa("ffmpeg", [
            "-y",
            "-i", path.join(audioDir, "origin.wav"),
            "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
            "-ar", "48000",
            "-ac", "2",
            aligned
        ], { stdio: "inherit" });
    } else {
        // Existing dubbing audio normalization
        const aligned = path.join(audioDir, "aligned.wav");
        await execa("ffmpeg", [
            "-y",
            "-i", track.url,
            "-af", "loudnorm=I=-16:LRA=11:TP=-1.5",
            "-ar", "48000",
            "-ac", "2",
            aligned
        ], { stdio: "inherit" });
    }

    // Generate HLS segments (same for all)
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

### 3. Master Playlist 생성 부분 수정 (약 280라인 근처)

**원본을 첫 번째로, 기본값으로 설정**
```typescript
const finalAudioEntries = allFinalTracks
    .sort((a, b) => {
        // Origin always comes first
        if (a.lang === "origin") return -1;
        if (b.lang === "origin") return 1;
        // Then sort alphabetically
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

## 🎨 프론트엔드 수정

### hls-player-modal.tsx / shaka-player-modal.tsx

**langNameMap에 원본 추가**
```typescript
const langNameMap: Record<string, string> = {
  origin: "원본", // 추가
  ko: "한국어",
  en: "영어",
  ja: "일본어",
  // ... 나머지 언어들
}
```

**오디오 트랙 정렬 (원본이 항상 첫 번째)**
```typescript
const formattedTracks = trackList
    .sort((a, b) => {
        // Origin always comes first
        if (a.lang === "origin" || a.language === "origin") return -1;
        if (b.lang === "origin" || b.language === "origin") return 1;
        return 0;
    })
    .map((track, index) => ({
        id: index,
        language: track.lang || track.language || track.name || '',
        label: langNameMap[track.lang || track.language || track.name || ''] || track.name || track.label || `Track ${index + 1}`,
        roles: track.roles || []
    }));
```

## 🎯 결과

- ✅ 원본 오디오가 `origin` 언어 코드로 저장
- ✅ 원본도 HLS 세그먼트로 변환되어 스트리밍
- ✅ 언어 선택에서 "원본"이 항상 첫 번째 옵션
- ✅ 기본 선택 언어가 원본으로 설정
- ✅ 한 번 생성된 원본은 재사용 (중복 처리 방지)