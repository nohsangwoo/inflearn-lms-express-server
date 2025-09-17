# Dubbing.ts Integration Patch

## 목적
`dubbing.ts`에서 더빙 작업 완료 후 DB 기반으로 master.m3u8를 재생성하도록 수정

## 필요한 수정사항

### 1. Import 추가
```typescript
// 기존 import 섹션에 추가
import { refreshMasterPlaylist } from "../lib/media/db-based-master.js";
```

### 2. Routes index.ts에 새 라우터 추가
```typescript
// src/routes/index.ts
import { router as refreshMaster } from "./refresh-master.js";

// 라우터 등록 섹션에 추가
router.use("/api/refresh-master", refreshMaster);
```

### 3. Dubbing 완료 후 Master Playlist 재생성
`dubbing.ts`의 업로드 직전 (약 270라인 근처)에 다음 코드 추가:

```typescript
		}

		// PATCH: DB 기반으로 master playlist 재생성
		console.log("[HLS] Regenerating master playlist from DB data...");
		try {
			await refreshMasterPlaylist({
				sectionId,
				masterPath
			});
			console.log("[HLS] Master playlist regenerated successfully");
		} catch (err) {
			console.error("[HLS] Failed to regenerate master playlist:", err);
			// Continue with upload even if master regeneration fails
		}

		// Upload everything to S3
		console.log("[HLS] Uploading to S3...");
```

## 테스트 방법

1. Express 서버 재시작 후 라우터 등록 확인
2. `/test-refresh-master.html` 페이지에서 수동 테스트
3. 새로운 더빙 요청으로 자동 재생성 테스트

## 기대 효과

- ✅ 모든 ready 상태 DubTrack이 master.m3u8에 포함
- ✅ 마지막 언어만 남는 문제 해결
- ✅ 프론트엔드에서 정확한 언어 목록 표시
- ✅ HLS 플레이어에서 모든 언어 선택 가능

## 참고 파일들

- `src/lib/media/db-based-master.ts` - DB 기반 master 생성 로직
- `src/routes/refresh-master.ts` - 수동 재생성 API
- `test-refresh-master.html` - 테스트 인터페이스