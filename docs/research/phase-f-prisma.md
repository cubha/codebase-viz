# Phase F 리서치: Prisma schema.prisma DSL 파싱

> 생성일: 2026-05-03 | 프로젝트: codebase-viz

## 권장안

**1순위: `@mrleebo/prisma-ast`**
- dist ~56KB + chevrotain ~156KB — vsce 번들 적합
- ESM/CJS 지원, Chevrotain 기반 재귀 하강 파서
- 주간 DL 1.8M, 2026-03 최신 릴리즈
- relation, @@id([...]), 멀티라인 attribute 완전 파싱

**부적합: `@prisma/internals`** — 136MB install, Rust WASM, semver 미보장  
**부적합: 정규식** — `@relation(fields: [a, b])` 멀티라인/복수필드 edge case에서 실패

## 사용 패턴

```typescript
import { getSchema } from '@mrleebo/prisma-ast';
const schema = getSchema(source);
const models = schema.list.filter(item => item.type === 'model');
for (const model of models) {
  for (const prop of model.properties) {
    if (prop.type === 'field') {
      // prop.name, prop.fieldType, prop.array, prop.optional, prop.attributes
    }
  }
}
```

## 주의사항
- AST shape 미공식 문서화 → 빌더 API 사용 권장
- 버전 업 시 내부 구조 변경 가능 → try/catch + silent skip 필수
