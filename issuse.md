
(현재 CloudFront/S3 설정은 끝났고, **init.mp4 403** 문제를 포함해 패키징·업로드·인벌리데이션까지 자동화합니다.)

---

# Task: CMAF HLS 패키징 + S3 업로드 + CloudFront 인벌리데이션 자동화

## 목적

* 동일 비디오에 대해 **언어별 오디오를 즉시 스위칭** 가능한 **CMAF HLS** 파이프라인을 완성한다.
* **init.mp4 누락/403** 문제를 없애고, 업로드/헤더/무효화까지 자동화한다.

---

## 디렉터리 & 키 레이아웃 (S3/CloudFront 공통)

```
assets/curriculumsection/{sectionId}/
  master.m3u8
  video/
    video.m3u8
    init.mp4
    v_000.m4s ...
  audio/
    {lang}/
      audio.m3u8
      init.mp4
      a_000.m4s ...
```

* 비디오는 1회 패키징 재사용(CMAF/fMP4).
* 오디오는 언어별 HLS로만 패키징.
* 마스터 `master.m3u8`에서 `#EXT-X-MEDIA`(오디오들) + `#EXT-X-STREAM-INF`(비디오)로 묶는다.

---

## 환경 변수

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_BUCKET_NAME=storage.lingoost.com
CLOUDFRONT_DISTRIBUTION_ID=E********
NEXT_PUBLIC_CDN_URL=https://storage.lingoost.com
TMP_DIR=/tmp  # 옵션
```

---

## 구현 요구사항 (필수)

### 1) ffmpeg로 CMAF HLS 패키징 (init.mp4 생성 포함)

* **비디오(최초 1회만):** 재인코딩 없이 복사(가능 시)

```bash
ffmpeg -y -i INPUT.mp4 \
  -map 0:v:0 -c:v copy \
  -f hls -hls_time 4 -hls_playlist_type vod \
  -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename 'v_%03d.m4s' \
  video/video.m3u8
```

* **오디오(언어별, ElevenLabs 산출물 -> AAC 48kHz 2ch):**

```bash
ffmpeg -y -i DUB_{lang}.mp3 \
  -c:a aac -b:a 128k -ar 48000 -ac 2 \
  -f hls -hls_time 4 -hls_playlist_type vod \
  -hls_segment_type fmp4 \
  -hls_fmp4_init_filename init.mp4 \
  -hls_segment_filename 'a_%03d.m4s' \
  audio/{lang}/audio.m3u8
```

> 각 `video.m3u8` / `audio.m3u8` 내부에는 반드시 `#EXT-X-MAP:URI="init.mp4"` 가 들어가야 하며, **S3에도 init.mp4를 업로드**해야 한다.

---

### 2) S3 업로드(멀티파트) + 정확한 메타데이터 부여

* **업로드 순서**

  1. `video/` 또는 `audio/{lang}/`의 **세그먼트(.m4s)와 init.mp4, 그리고 video.m3u8/audio.m3u8** 업로드
  2. **마지막에** `master.m3u8` 업로드
  3. CloudFront **CreateInvalidation**(경로: `/assets/curriculumsection/{sectionId}/master.m3u8`)

* **Content-Type / Cache-Control 매핑**

  | 확장자        | Content-Type                    | Cache-Control                         |
  | ---------- | ------------------------------- | ------------------------------------- |
  | `.m3u8`    | `application/vnd.apple.mpegurl` | `public, max-age=60`                  |
  | `.m4s`     | `video/iso.segment`             | `public, max-age=31536000, immutable` |
  | `init.mp4` | `video/mp4`                     | `public, max-age=31536000, immutable` |

* Node/TS 업로더 스켈레톤

```ts
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { createReadStream } from "fs";
const region = env.AWS_REGION;
if (!region) throw new Error("AWS_REGION not set");
const s3 = new S3Client({
	region,
	...(env.AWS_ACCESS_KEY && env.AWS_SECRET_KEY
		? { credentials: { accessKeyId: env.AWS_ACCESS_KEY, secretAccessKey: env.AWS_SECRET_KEY } }
		: {}),
});
const CT: Record<string, string> = {
  ".m3u8": "application/vnd.apple.mpegurl",
  ".m4s": "video/iso.segment",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg"
};

async function uploadFile(localPath: string, key: string) {
  const ext = key.slice(key.lastIndexOf("."));
  const ContentType = CT[ext] ?? "application/octet-stream";
  const CacheControl =
    ext === ".m3u8" ? "public, max-age=60" : "public, max-age=31536000, immutable";

  await s3.send(new PutObjectCommand({
    Bucket: process.env.AWS_BUCKET_NAME!,
    Key: key,
    Body: createReadStream(localPath),
    ContentType,
    CacheControl,
    ServerSideEncryption: "AES256"
  }));
}
```

---

### 3) master.m3u8 생성/갱신

* **샘플 템플릿**

```m3u8
#EXTM3U
# 오디오 트랙들 (ko를 기본값 예시)
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Korean",LANGUAGE="ko",AUTOSELECT=YES,DEFAULT=YES,URI="audio/ko/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="English",LANGUAGE="en",AUTOSELECT=YES,DEFAULT=NO,URI="audio/en/audio.m3u8"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",NAME="Japanese",LANGUAGE="ja",AUTOSELECT=YES,DEFAULT=NO,URI="audio/ja/audio.m3u8"

# 비디오 스트림(단일 해상도 예시; 다중 ABR 시 여러 줄 추가, 모두 AUDIO="aud")
#EXT-X-STREAM-INF:BANDWIDTH=2500000,CODECS="avc1.4d401f",RESOLUTION=1920x1080,AUDIO="aud"
video/video.m3u8
```

* **생성/갱신 로직**

  * `video/video.m3u8` 존재 확인(없으면 1회 생성).
  * 추가하려는 `{lang}`마다 `audio/{lang}/audio.m3u8` 존재 확인 후 `#EXT-X-MEDIA` 라인 추가/중복 방지.
  * 파일 저장 → S3 업로드(위 헤더로) → **CloudFront 무효화**(마스터만).

---

### 4) CloudFront Invalidation 자동화

* **IAM 최소 권한 (배포/서버 IAM에 추가)**

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["cloudfront:CreateInvalidation"], "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>" },
    { "Effect": "Allow", "Action": ["cloudfront:GetInvalidation","cloudfront:ListInvalidations"], "Resource": "arn:aws:cloudfront::<ACCOUNT_ID>:distribution/<DISTRIBUTION_ID>" }
  ]
}
```

* **Node/TS**

```ts
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
const cf = new CloudFrontClient({ region: "us-east-1" }); // CloudFront는 글로벌

export async function invalidateMaster(sectionId: number) {
  const path = `/assets/curriculumsection/${sectionId}/master.m3u8`;
  const CallerReference = `m3u8-${sectionId}-${Date.now()}`;
  await cf.send(new CreateInvalidationCommand({
    DistributionId: process.env.CLOUDFRONT_DISTRIBUTION_ID!,
    InvalidationBatch: { CallerReference, Paths: { Quantity: 1, Items: [path] } }
  }));
}
```

---

### 5) API 플로우 (요약)

`POST /api/dubbing`

```json
{
  "inputVideoUrl": "s3://.../source.mp4",
  "targetLanguages": ["ko", "en", "ja"],
  "curriculumSectionId": 11
}
```

* 처리 순서

  1. **비디오 HLS 존재 확인** → 없으면 1회 **CMAF 패키징**(video.m3u8 + init.mp4 + m4s) → S3 업로드
  2. 각 `{lang}`에 대해: ElevenLabs 더빙(mp3) → **오디오 CMAF 패키징**(audio.m3u8 + init.mp4 + m4s) → S3 업로드
  3. `master.m3u8` 갱신(템플릿 반영) → S3 업로드
  4. **CloudFront Invalidation**: `/assets/curriculumsection/{sectionId}/master.m3u8`
  5. 응답: `{ ok, sectionId, languagesReady: [...], masterUrl: "https://storage.lingoost.com/assets/curriculumsection/{id}/master.m3u8" }`

* **경쟁 갱신 방지**: 동일 섹션에 대한 더빙 작업은 서버에서 **직렬 처리**(큐/뮤텍스)로 보장.

---

### 6) 에러 대응 / 재시도

* 업로드 실패 시 **지수 백오프** 재시도(최대 3회).
* ffmpeg 실패 로그 캡처 후 실패 언어만 재시도 가능하도록 idempotent 설계.
* CloudFront `TooManyInvalidationsInProgress` → 2\~5초 간격 재시도.

---

## 수용 기준 (Acceptance Criteria)

* `assets/curriculumsection/{sectionId}/video/`에 `video.m3u8`, **`init.mp4`**, `v_***.m4s`가 존재한다.
* 각 언어 `assets/.../audio/{lang}/`에 `audio.m3u8`, **`init.mp4`**, `a_***.m4s`가 존재한다.
* `master.m3u8`의 `#EXT-X-MEDIA`/`#EXT-X-STREAM-INF`가 올바르며, **버튼으로 언어 즉시 전환**(hls.js) 가능하다.
* S3의 메타데이터가 표와 정확히 일치한다. (특히 `init.mp4=video/mp4`, `.m4s=video/iso.segment`)
* 언어 추가 직후 **마스터만** 인벌리데이트되어 60초 이내가 아니라도 즉시 반영된다.
* 검증 커맨드:

  ```bash
  curl -I -H "Origin: http://localhost:3000" https://storage.lingoost.com/assets/curriculumsection/{id}/video/video.m3u8
  curl -I -H "Origin: http://localhost:3000" https://storage.lingoost.com/assets/curriculumsection/{id}/video/init.mp4
  curl -I -H "Origin: http://localhost:3000" https://storage.lingoost.com/assets/curriculumsection/{id}/audio/ko/init.mp4
  ```

  위 3개 모두 **200** 이고, `Content-Type`/`Cache-Control` 헤더가 표와 동일해야 한다.

---

## 참고 메모

* CloudFront Behaviors는 이미 구성됨:

  * `/assets/*/*/master.m3u8` → 짧은 캐시(60s)
  * `/assets/*` → 긴 캐시(1y)
* 프론트는 `crossOrigin="anonymous"` + hls.js 이벤트 동기화 적용.
* **문제의 원흉이던 403**은 대부분 `init.mp4` 누락/경로 불일치/메타 미설정에서 발생 → 본 작업으로 해결.

---

이 스펙대로 구현해 주세요.
