# Phase F 리서치: Vue SFC / Svelte SFC script 블록 파싱

> 생성일: 2026-05-03 | 프로젝트: codebase-viz

## 권장안: 정규식으로 script 블록 추출 + ts-morph import 분석

`@vue/compiler-sfc`와 `svelte/compiler`는 무거운 의존성 추가 없이
정규식으로 `<script>` 블록을 추출한 뒤 ts-morph에 공급하면 충분하다.
import 그래프만 필요한 F-2 범위에서는 완전 AST 파싱이 불필요.

## Vue SFC

```typescript
// <script> or <script setup lang="ts"> 블록 추출
const SCRIPT_RE = /<script(?:\s[^>]*)?>[\s\S]*?<\/script>/g;
function extractVueScript(source: string): string | null {
  const match = source.match(/<script(?:\s[^>]*)?>(?<content>[\s\S]*?)<\/script>/);
  return match?.groups?.content ?? null;
}
```

- `<script setup>`: lang="ts" 여부와 무관하게 content만 추출
- 추출된 content → ts-morph `Project.createSourceFile()` → import 분석

## Svelte SFC

```typescript
function extractSvelteScript(source: string): string | null {
  // <script> (instance) 블록만. <script context="module">은 제외
  const match = source.match(/<script(?:\s(?!context)[^>]*)?>(?<content>[\s\S]*?)<\/script>/);
  return match?.groups?.content ?? null;
}
```

## 공통 import 그래프 추출 (ts-morph)

```typescript
import { Project } from 'ts-morph';
const project = new Project({ useInMemoryFileSystem: true });
const sf = project.createSourceFile('__sfc.ts', scriptContent);
const imports = sf.getImportDeclarations()
  .map(d => d.getModuleSpecifierValue())
  .filter(m => m.startsWith('.') || m.startsWith('@/'));
```

## 주의사항
- template 내 `<MyComponent />` 사용 추적은 F-2 범위 밖 (import 기반만)
- `lang="js"` SFC는 ts-morph가 처리 가능 (allowJs 옵션)
- 파싱 실패 시 silent skip + inferenceChain 기록
