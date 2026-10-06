import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { Project, SyntaxKind } from 'ts-morph'
import {
  createTableNode,
  makeNodeId,
  ORM_CLASS_PREFIX,
  type TableNode,
  type ColumnDef,
  type Provenance,
} from '@codebase-viz/types'
import { findTsFiles } from '../adapters/_shared/file-finder.js'

const COLUMN_DECORATORS = new Set([
  'Column', 'PrimaryColumn', 'PrimaryGeneratedColumn',
  'CreateDateColumn', 'UpdateDateColumn', 'DeleteDateColumn',
])
const RELATION_DECORATORS = new Set(['ManyToOne', 'OneToOne'])

function resolveColumnNullable(
  prop: import('ts-morph').PropertyDeclaration,
  isPrimary: boolean,
  colDecorator: import('ts-morph').Decorator,
): boolean {
  if (isPrimary) return false

  const args = colDecorator.getArguments()
  if (args.length > 0) {
    const first = args[0]!
    if (first.isKind(SyntaxKind.ObjectLiteralExpression)) {
      const nullableProp = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('nullable')
      if (nullableProp?.isKind(SyntaxKind.PropertyAssignment)) {
        const init = nullableProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
        if (init?.isKind(SyntaxKind.TrueKeyword)) return true
        if (init?.isKind(SyntaxKind.FalseKeyword)) return false
      }
    }
  }

  if (prop.hasQuestionToken()) return true
  const typeText = prop.getTypeNode()?.getText() ?? ''
  if (typeText.includes('| null') || typeText.includes('| undefined') ||
      typeText.includes('null |') || typeText.includes('undefined |')) return true

  return false
}

function resolveEntityName(cls: import('ts-morph').ClassDeclaration): string {
  const decorator = cls.getDecorators().find(d => d.getName() === 'Entity')
  if (decorator === undefined) return cls.getName() ?? 'unknown'
  const args = decorator.getArguments()
  if (args.length === 0) return (cls.getName() ?? 'unknown').toLowerCase()
  const first = args[0]!
  if (first.isKind(SyntaxKind.StringLiteral)) {
    return first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
  }
  if (first.isKind(SyntaxKind.ObjectLiteralExpression)) {
    const nameProp = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('name')
    if (nameProp?.isKind(SyntaxKind.PropertyAssignment)) {
      const init = nameProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
      if (init?.isKind(SyntaxKind.StringLiteral)) {
        return init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
      }
    }
  }
  return (cls.getName() ?? 'unknown').toLowerCase()
}

// 데코레이터 옵션 객체의 문자열 프로퍼티(`@Column({ name })`·`@JoinColumn({ name, referencedColumnName })`).
function decoratorOption(dec: import('ts-morph').Decorator, key: string): string | undefined {
  const first = dec.getArguments()[0]
  if (first === undefined || !first.isKind(SyntaxKind.ObjectLiteralExpression)) return undefined
  const prop = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty(key)
  if (!prop?.isKind(SyntaxKind.PropertyAssignment)) return undefined
  const init = prop.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
  return init?.isKind(SyntaxKind.StringLiteral) ? init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue() : undefined
}

// 엔티티별 프로퍼티 → DB 컬럼명과 PK 컬럼명. FK가 가리키는 쪽의 **DB 이름**을 알아야 참조 컬럼을 맞게 적는다.
interface EntityColumns { dbNameByProp: Map<string, string>; pk: string | undefined }

function collectEntityColumns(cls: import('ts-morph').ClassDeclaration): EntityColumns {
  const dbNameByProp = new Map<string, string>()
  let pk: string | undefined
  for (const prop of cls.getProperties()) {
    const dec = prop.getDecorators().find(d => COLUMN_DECORATORS.has(d.getName()))
    if (dec === undefined) continue
    const dbName = decoratorOption(dec, 'name') ?? prop.getName()
    dbNameByProp.set(prop.getName(), dbName)
    if (pk === undefined && (dec.getName() === 'PrimaryColumn' || dec.getName() === 'PrimaryGeneratedColumn')) pk = dbName
  }
  return { dbNameByProp, pk }
}

export async function parseTypeOrmEntities(
  repoRoot: string,
  analyzerVersion: string,
): Promise<TableNode[]> {
  const allFiles = await findTsFiles(repoRoot, { includeTsx: false, excludeDeclarations: true, excludeTests: true })

  const entityFiles: string[] = []
  for (const f of allFiles) {
    const content = await fs.readFile(f, 'utf-8').catch(() => '')
    if (/@Entity\s*\(/.test(content)) entityFiles.push(f)
  }
  if (entityFiles.length === 0) return []

  const project = new Project({
    compilerOptions: {
      target: 99,
      experimentalDecorators: true,
      emitDecoratorMetadata: true,
      allowJs: false,
      strict: false,
    },
    skipAddingFilesFromTsConfig: true,
  })
  for (const f of entityFiles) project.addSourceFileAtPath(f)

  // 관계 데코레이터는 대상 **클래스**를 가리키지만 ERD의 FK 선은 **테이블명**끼리 잇는다 —
  // 클래스명을 그대로 두면 `@Entity('users') class User`처럼 이름이 다른 순간 FK 선이 조용히 드롭된다.
  // JPA 파서(classToTableMap)와 같은 선행 패스.
  const classToTable = new Map<string, string>()
  const classColumns = new Map<string, EntityColumns>()
  for (const sourceFile of project.getSourceFiles()) {
    for (const cls of sourceFile.getClasses()) {
      const className = cls.getName()
      if (className === undefined || !cls.getDecorators().some(d => d.getName() === 'Entity')) continue
      classToTable.set(className, resolveEntityName(cls))
      classColumns.set(className, collectEntityColumns(cls))
    }
  }

  const tables: TableNode[] = []

  for (const sourceFile of project.getSourceFiles()) {
    const filePath = sourceFile.getFilePath()
    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')

    for (const cls of sourceFile.getClasses()) {
      if (!cls.getDecorators().some(d => d.getName() === 'Entity')) continue

      const tableName = resolveEntityName(cls)
      const columns: ColumnDef[] = []

      const provenance: Provenance = {
        file: relPath,
        line: cls.getStartLineNumber(),
        adapter: 'typeorm-parser@0.1',
        analyzerVersion,
      }

      for (const prop of cls.getProperties()) {
        const colDecorator = prop.getDecorators().find(d => COLUMN_DECORATORS.has(d.getName()))
        if (colDecorator !== undefined) {
          let colType = prop.getTypeNode()?.getText() ?? 'unknown'
          const isPrimary = colDecorator.getName() === 'PrimaryColumn'
            || colDecorator.getName() === 'PrimaryGeneratedColumn'

          // `@Column({ name: 'user_name' })`처럼 DB 실제 컬럼명을 따로 줄 수 있다 — 없으면 프로퍼티명.
          let dbName: string | undefined
          const args = colDecorator.getArguments()
          if (args.length > 0) {
            const first = args[0]!
            if (first.isKind(SyntaxKind.StringLiteral)) {
              colType = first.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
            } else if (first.isKind(SyntaxKind.ObjectLiteralExpression)) {
              const nameProp = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('name')
              if (nameProp?.isKind(SyntaxKind.PropertyAssignment)) {
                const init = nameProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
                if (init?.isKind(SyntaxKind.StringLiteral)) dbName = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
              }
              const typeProp = first.asKindOrThrow(SyntaxKind.ObjectLiteralExpression).getProperty('type')
              if (typeProp?.isKind(SyntaxKind.PropertyAssignment)) {
                const init = typeProp.asKindOrThrow(SyntaxKind.PropertyAssignment).getInitializer()
                if (init?.isKind(SyntaxKind.StringLiteral)) {
                  colType = init.asKindOrThrow(SyntaxKind.StringLiteral).getLiteralValue()
                }
              }
            }
          }

          const nullable = resolveColumnNullable(prop, isPrimary, colDecorator)
          columns.push({ name: dbName ?? prop.getName(), type: colType, nullable, isPrimaryKey: isPrimary })
          continue
        }

        const relDecorator = prop.getDecorators().find(d => RELATION_DECORATORS.has(d.getName()))
        if (relDecorator !== undefined) {
          const args = relDecorator.getArguments()
          const first = args[0]
          let targetEntity: string | undefined
          if (first !== undefined) {
            if (first.isKind(SyntaxKind.ArrowFunction)) {
              const arrowFn = first.asKindOrThrow(SyntaxKind.ArrowFunction)
              const body = arrowFn.getBody()
              if (body.isKind(SyntaxKind.Identifier)) {
                targetEntity = body.getText()
              } else if (body.isKind(SyntaxKind.Block)) {
                const returnStmt = body.getStatements().find(s => s.isKind(SyntaxKind.ReturnStatement))
                const expr = returnStmt?.asKind(SyntaxKind.ReturnStatement)?.getExpression()
                if (expr?.isKind(SyntaxKind.Identifier)) targetEntity = expr.getText()
              }
            } else {
              const text = first.getText()
              const m = text.match(/=>\s*(\w+)/)
              if (m !== null) targetEntity = m[1]!
            }
          }
          // FK 컬럼은 소유측에만 있다 — @ManyToOne은 항상 소유측, @OneToOne은 @JoinColumn이 붙은 쪽만.
          // 역방향에 FK를 만들면 ERD에 없는 컬럼·관계선이 생긴다(v1.2.69 이전 결함).
          const joinColumn = prop.getDecorators().find(d => d.getName() === 'JoinColumn')
          const ownsFk = relDecorator.getName() === 'ManyToOne' || joinColumn !== undefined
          if (targetEntity !== undefined && ownsFk) {
            const target = classColumns.get(targetEntity)
            const referencedProp = joinColumn !== undefined ? decoratorOption(joinColumn, 'referencedColumnName') : undefined
            const referencedColumn = referencedProp !== undefined
              ? (target?.dbNameByProp.get(referencedProp) ?? referencedProp)
              : (target?.pk ?? 'id')
            // @JoinColumn 없는 기본 FK 이름은 NamingStrategy에 따라 달라 정적으로 확정할 수 없다 — 프로퍼티명 유지.
            columns.push({
              name: (joinColumn !== undefined ? decoratorOption(joinColumn, 'name') : undefined) ?? prop.getName(),
              type: relDecorator.getName(),
              nullable: true,
              references: { table: classToTable.get(targetEntity) ?? targetEntity, column: referencedColumn },
            })
          }
        }
      }

      tables.push(
        createTableNode({
          id: makeNodeId('table', relPath, tableName),
          name: tableName,
          columns,
          provenance,
          confidence: 'inferred',
          inferenceChain: [
            `typeorm: @Entity('${tableName}') in ${relPath}`,
            ...(cls.getName() !== undefined ? [`${ORM_CLASS_PREFIX}${cls.getName()}`] : []),
          ],
        }),
      )
    }
  }

  return tables
}
