## 목적

동일 비디오에 대해 언어별 오디오를 즉시 스위칭 가능한 CMAF HLS 스트리밍 파이프라인을 정의합니다. 비디오는 1회만 패키징하고, 오디오는 언어별로 분리하여 관리합니다.

## S3/CDN 디렉터리 레이아웃

```
assets/curriculumsection/{sectionId}/
  master.m3u8
  video/
    video.m3u8
    v_000.m4s ...
  audio/
    ja/
      audio.m3u8
      a_000.m4s ...
    en/
      audio.m3u8
      a_000.m4s ...
```

- 비디오: 공용 1개(CMAF fMP4 조각 + `video.m3u8`)
- 오디오: 언어별 조각 + `audio.m3u8`
- 마스터: `master.m3u8`에 `#EXT-X-MEDIA`(오디오 트랙들) + `#EXT-X-STREAM-INF`(비디오) 정의

## 백엔드 API (요약)

- 엔드포인트: `POST /api/dubbing`
- 바디 예시

```json
{
  "inputVideoUrl": "https://.../master.mp4",
  "targetLanguages": ["ja", "en"],
  "curriculumSectionId": 123
}
```

- 처리 요약
  - ElevenLabs로 언어별 더빙 오디오 생성 → 즉시 S3 업로드(로컬 저장 X)
  - 임시 경로 업로드 후 서버 사이드 copy로 최종 경로 이동: `assets/curriculumsection/{sectionId}/audio/{lang}/...`
  - `DubTrack`에 CDN URL 저장(`NEXT_PUBLIC_CDN_URL + key`)
  - 비디오는 합성하지 않음(오디오는 HLS에서 분리 트랙로 동작)

## 프론트 재생 (Next.js + hls.js)

```tsx
"use client";
import React, { useEffect, useRef, useState } from "react";
import Hls from "hls.js";

type Track = { lang: string; name: string; index: number };
export default function VideoPlayer({ sectionId }: { sectionId: number }) {
  const masterUrl = `${process.env.NEXT_PUBLIC_CDN_URL}/assets/curriculumsection/${sectionId}/master.m3u8`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const [hls, setHls] = useState<Hls | null>(null);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [curIdx, setCurIdx] = useState<number>(-1);

  useEffect(() => {
    const video = videoRef.current!;
    if (Hls.isSupported()) {
      const _hls = new Hls({ enableWorker: true });
      _hls.loadSource(masterUrl);
      _hls.attachMedia(video);
      _hls.on(Hls.Events.MANIFEST_PARSED, () => {
        const list = _hls.audioTracks.map((t, i) => ({ lang: t.lang ?? String(i), name: t.name ?? t.lang ?? String(i), index: i }));
        setTracks(list);
        const saved = localStorage.getItem("lesson_lang");
        if (saved) {
          const idx = list.findIndex(t => t.lang === saved);
          if (idx >= 0) { _hls.audioTrack = idx; setCurIdx(idx); }
        } else { setCurIdx(_hls.audioTrack); }
      });
      setHls(_hls);
      return () => { _hls.destroy(); };
    }
    if (video.canPlayType("application/vnd.apple.mpegurl")) video.src = masterUrl;
  }, [masterUrl]);

  const switchLang = (lang: string) => {
    if (!hls) return;
    const idx = tracks.findIndex(t => t.lang === lang);
    if (idx >= 0) { hls.audioTrack = idx; setCurIdx(idx); localStorage.setItem("lesson_lang", lang); }
  };

  return (
    <div>
      <video ref={videoRef} controls playsInline style={{ width: "100%" }} />
      <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
        {tracks.map(t => (
          <button key={t.index} onClick={() => switchLang(t.lang)}>
            {t.name} ({t.lang})
          </button>
        ))}
      </div>
    </div>
  );
}
```

### 프론트 구현 가이드(요약)

- 환경 변수
  - `NEXT_PUBLIC_CDN_URL`(필수): CDN 베이스 URL. 예) `https://storage.lingoost.com`
- 라이브러리
  - `hls.js` 설치: `pnpm add hls.js`
- 플레이어 컴포넌트
  - 위 예시처럼 `master.m3u8`만 로드하고 `audioTracks`로 언어 목록 표시
  - 선택 언어는 `localStorage('lesson_lang')`로 저장/복원
- Safari(iOS)
  - 네이티브 HLS 지원 → `video.src = masterUrl` 분기 유지
- 접근성/UX
  - 키보드 포커스 가능한 언어 버튼, 현재 선택 상태 명확 표기
  - 로딩/에러 상태 표시(네트워크 오류, 404 등)
- 프리로딩
  - 자주 쓰는 언어 1-2개는 초기화 직후 `hls.startLoad()` 상태에서 자연히 소량 프리페치됨

### 프론트에서 해야 할 일(체크리스트)

- [ ] `NEXT_PUBLIC_CDN_URL` 설정
- [ ] `VideoPlayer` 컴포넌트 페이지에 연결(`sectionId` 전달)
- [ ] 에러/로딩 처리(스피너, 재시도 버튼)
- [ ] 언어 선택 UI(현재 언어 강조)
- [ ] 이동형 네트워크(3G/5G) 대비 자동 화질 적응(HLS 기본 제공)

## 패키징/업로드 권장

- 비디오: 1회 CMAF HLS 패키징(`video/video.m3u8` + `v_***.m4s`)
- 오디오: 언어별 HLS 패키징(`/audio/{lang}/audio.m3u8` + `a_***.m4s`)
- `master.m3u8` 작성/갱신: 각 언어를 `#EXT-X-MEDIA`로 추가, 비디오 스트림은 `AUDIO="aud"` 참조
- 업로드: 디렉터리 병렬 업로드(멀티파트 병행). 세그먼트는 immutable 캐시, master는 짧은 TTL

## 백엔드 API & 자동화(서버 측)

- 더빙 API(이미 구현): `POST /api/dubbing`
  - 입력: `inputVideoUrl`, `targetLanguages[]`, `curriculumSectionId`
  - 처리:
    1) ElevenLabs로 각 언어 더빙 오디오 생성 → S3 업로드(`assets/curriculumsection/{sectionId}/audio/{lang}/{videoId}.mp3`)
    2) 비디오/오디오 HLS 자동 패키징(서버 내 ffmpeg 실행)
       - 비디오: 미존재 시 1회 패키징 → `video/video.m3u8` + `v_***.m4s`
       - 오디오: 언어별 패키징 → `audio/{lang}/audio.m3u8` + `a_***.m4s`
       - `master.m3u8` 갱신(EXT-X-MEDIA 추가)
    3) `DubTrack`에 결과 URL 저장, 응답 반환
  - 응답: `{ ok, videoId, results: [{ lang, dubbingId, url }] }`

### 서버 환경 변수

- `ELEVENLABS_API_KEY`
- `AWS_ACCESS_KEY`, `AWS_SECRET_KEY`, `AWS_REGION`, `AWS_BUCKET_NAME`
- `NEXT_PUBLIC_CDN_URL`
- `TEMP_DIR`(옵션, 기본 OS tmp)

### S3 권한/IAM

- 업로더 IAM(예: `cdn-deployer`)에 아래 권한 필요
  - `s3:PutObject`, `s3:GetObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts`
  - 버킷 레벨: `s3:ListBucket`, `s3:ListBucketMultipartUploads`
  - (KMS 사용 시) `kms:Encrypt`, `kms:GenerateDataKey`, `kms:Decrypt`
- 버킷 정책 예시: 업로더에 위 권한 허용, CloudFront OAI/OAC에는 GetObject 허용

## 운영 팁

- 세그먼트 TTL을 길게(immutable), `master.m3u8`만 짧게 유지 후 갱신
- 언어 추가 시 오디오만 업로드 → `master.m3u8` 갱신/무효화(CloudFront Invalidations)
- 대용량 트래픽 대비: 세그먼트 경로 고정, 파일 내용 불변 원칙 유지
- 임시 파일은 서버 `/tmp`에 생성 후 업로드 완료 시 삭제(이미 구현)

## 헤더/캐시 권장

- Content-Type
  - `.m3u8`: `application/vnd.apple.mpegurl`
  - `.m4s`: `video/iso.segment`
  - `.mp4`: `video/mp4`, `.mp3`: `audio/mpeg`
- Cache-Control
  - 세그먼트: `public, max-age=31536000, immutable`
  - master.m3u8: `public, max-age=60`
- 기타: CORS 허용, Range 요청 지원(CloudFront 정책)

## 장점 요약

- 비디오 1회 패키징 후 재사용 → 비용/시간 절감
- 언어 추가 시 오디오만 추가 → 빠른 확장
- 플레이어에서 즉시 언어 스위칭 → UX 우수

## 문제 해결(FAQ)

- m3u8/세그먼트가 안 올라온다 → S3 권한(403) 확인, 버킷 정책/업로더 IAM 점검
- Safari에서 재생 안 됨 → `video.canPlayType('application/vnd.apple.mpegurl')` 분기 확인
- 언어 목록이 비어있다 → `master.m3u8`의 `#EXT-X-MEDIA` 라인 생성 여부 확인


