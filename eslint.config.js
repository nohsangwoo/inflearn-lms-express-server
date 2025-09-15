// ESLint는 '코드 가이드라인 지킴이'입니다.
// 문법 실수나 안티패턴을 미리 알려줘요.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // 자바스크립트 기본 추천 규칙
  js.configs.recommended,
  // 타입스크립트 추천 규칙
  ...tseslint.configs.recommended,
  {
    // 언어/파서 옵션
    languageOptions: {
      // 최신 문법 + ESM 사용
      parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    },
    // 팀 취향에 맞춘 추가 규칙
    rules: {
      "no-console": "warn", // console.log 남발 주의
      "@typescript-eslint/consistent-type-imports": "warn", // 타입 import 일관성,
      "@typescript-eslint/no-unused-vars":[
        "error",
        {
            "argsIgnorePattern": "^_",
            "varsIgnorePattern": "^_"        }
      ]
    },
    // 검사에서 제외할 폴더
    ignores: ["dist"]
  }
);
