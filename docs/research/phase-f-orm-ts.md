# Phase F 리서치: Drizzle pgTable + TypeORM 데코레이터 ts-morph 추출

> 생성일: 2026-05-03 | 프로젝트: codebase-viz

## 권장안: 별도 파서 파일 (drizzle-parser.ts / typeorm-parser.ts)

두 ORM은 AST 구조가 완전히 달라 공통 추상화 불가.
공통 인터페이스(OrmTableNode)만 공유하고 내부 구현 분리.

## Drizzle 패턴

```typescript
// 객체 형: pgTable('users', { id: integer('id').primaryKey(), name: text('name') })
// 콜백 형: pgTable('users', (t) => ({ id: t.integer().primaryKey() }))
// 감지 함수: pgTable, sqliteTable, mysqlTable
// 진입점: VariableDeclaration → CallExpression → 함수명 매칭
```

**엣지 케이스:**
- import 별칭 (`pgTable as table`) → v1 skip + inferenceChain
- 동적 테이블명 (`pgTable(TABLE_NAME, ...)`) → silent skip
- 콜백 형 block body (`() => { return {...} }`) → 추가 분기

## TypeORM 패턴

```typescript
// @Entity('users') / @Entity({ name: 'users' }) / @Entity()
// @Column() / @Column('varchar') / @Column({ type: 'varchar', nullable: true })
// 진입점: ClassDeclaration.getDecorators() → @Entity 감지
//         PropertyDeclaration.getDecorators() → COLUMN_DECORATORS 감지
```

**엣지 케이스:**
- `@Column()` 인자 없음 → TS 타입 어노테이션 fallback
- import 별칭 (`Column as Col`) → v1 skip
- 추상 기반 클래스 상속 → 현재 파일 내 선언만 수집

## 감지 우선순위

```
drizzle-parser → typeorm-parser → prisma-parser → [] (silent skip)
```

## Less is More 적용

```typescript
confidence: 'inferred',
inferenceChain: ['drizzle: pgTable() detected', 'columns: 3 extracted, 1 skipped'],
```
