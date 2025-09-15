// tsup은 typescript를 쉽게 번들해주는 도구
// 빠르고 설정이 간단

import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts"], // 실행 진입점
  format: ["esm"],          // ESM 출력
  target: "node22",         // Node 22 최적화
  sourcemap: true,          // 에러시 원본 위치 디버깅 용이
  clean: true               // 빌드 전에 dist 비우기
});