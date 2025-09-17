# Master.m3u8 Multiple Languages Fix

## 🎯 문제
- master.m3u8에 마지막 더빙 언어만 저장됨
- 여러 언어가 있어도 하나만 표시되는 문제

## ✅ 해결 방법
`dubbing.ts`에서 3가지 핵심 수정:

### 1. 초기 Master Playlist 생성 시 (약 193라인)
**기존:**
```typescript
await upsertMasterPlaylist({
    masterPath,
    videoM3u8Rel: "video/video.m3u8",
    audioEntries: []  // ❌ 빈 배열로 시작
});
```

**수정:**
```typescript
// DB에서 모든 ready 상태 트랙 조회
const initialReadyTracks = await prisma.dubTrack.findMany({
    where: { videoId: video.id, status: "ready" },
    orderBy: { lang: 'asc' }
});

const initialAudioEntries = initialReadyTracks.map(track => ({
    lang: track.lang,
    name: track.lang,
    uri: `audio/${track.lang}/audio.m3u8`,
    groupId: "aud",
    defaultFlag: track.lang === "ja" || track.lang === "ko"
}));

await upsertMasterPlaylist({
    masterPath,
    videoM3u8Rel: "video/video.m3u8",
    audioEntries: initialAudioEntries  // ✅ 기존 트랙 모두 포함
});
```

### 2. 개별 언어 처리 시 (약 260라인)
**기존:**
```typescript
// 각 언어마다 patchMasterAddAudio 호출
await patchMasterAddAudio({
    masterPath,
    lang,
    name: lang,
    uri: `audio/${lang}/audio.m3u8`,
    groupId: "aud",
    defaultFlag: lang === "ko"
});
```

**수정:**
```typescript
// 개별 패치 제거 - 나중에 한번에 재생성
```

### 3. S3 업로드 전 최종 재생성 (약 270라인)
**추가 코드:**
```typescript
// 모든 언어 처리 완료 후, DB에서 전체 목록 가져와 재생성
console.log("[HLS] Regenerating master playlist with all dub tracks from DB...");

const allFinalTracks = await prisma.dubTrack.findMany({
    where: { videoId: video.id, status: "ready" },
    orderBy: { lang: 'asc' }
});

const finalAudioEntries = allFinalTracks.map(track => ({
    lang: track.lang,
    name: track.lang,
    uri: `audio/${track.lang}/audio.m3u8`,
    groupId: "aud",
    defaultFlag: track.lang === "ja" || track.lang === "ko"
}));

console.log("[HLS] Final audio entries:", finalAudioEntries);

// 모든 언어 포함하여 master playlist 재생성
await upsertMasterPlaylist({
    masterPath,
    videoM3u8Rel: "video/video.m3u8",
    audioEntries: finalAudioEntries
});

console.log("[HLS] Master playlist regenerated with all languages");

// 이제 S3에 업로드
console.log("[HLS] Uploading to S3...");
```

## 📋 최종 master.m3u8 형식
```m3u8
#EXTM3U
#EXT-X-VERSION:7
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="en",LANGUAGE="en",AUTOSELECT=YES,DEFAULT=NO,URI="audio/en/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="fr",LANGUAGE="fr",AUTOSELECT=YES,DEFAULT=NO,URI="audio/fr/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="ja",LANGUAGE="ja",AUTOSELECT=YES,DEFAULT=YES,URI="audio/ja/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="sv",LANGUAGE="sv",AUTOSELECT=YES,DEFAULT=NO,URI="audio/sv/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="zh",LANGUAGE="zh",AUTOSELECT=YES,DEFAULT=NO,URI="audio/zh/audio.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.4d401f,mp4a.40.2",RESOLUTION=1920x1080,AUDIO="aud"
video/video.m3u8
```

## 🚀 적용 방법
1. `dubbing-fixed.ts` 내용을 기존 `dubbing.ts`에 적용
2. Express 서버 재시작
3. 새 더빙 요청 테스트

## ✨ 결과
- ✅ 모든 ready 상태 언어가 master.m3u8에 포함
- ✅ 프론트엔드에서 모든 언어 선택 가능
- ✅ 언어 추가/삭제 시 자동 반영