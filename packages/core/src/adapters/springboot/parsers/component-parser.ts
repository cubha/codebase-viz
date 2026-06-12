import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import {
  createComponentNode,
  makeNodeId,
  type ComponentNode,
  type Provenance,
} from '@codebase-viz/types'
import { createJavaParser } from '../../_shared/tree-sitter-loader.js'
import { findJavaFiles } from '../../_shared/file-finder.js'

const COMPONENT_ANNOTATIONS = new Set(['Service', 'Component', 'Repository', 'Mapper', 'Controller', 'RestController'])

function getAnnotationName(annotNode: import('web-tree-sitter').SyntaxNode): string | undefined {
  for (let i = 0; i < annotNode.childCount; i++) {
    const child = annotNode.child(i)
    if (child !== null && child.type === 'identifier') return child.text
    if (child !== null && child.type === 'scoped_identifier') {
      const last = child.lastChild
      if (last !== null) return last.text
    }
  }
  return undefined
}

export async function parseSpringComponents(
  repoRoot: string,
  analyzerVersion: string,
): Promise<ComponentNode[]> {
  const javaFiles = await findJavaFiles(repoRoot)
  if (javaFiles.length === 0) return []

  const parser = await createJavaParser()
  const nodes: ComponentNode[] = []

  for (const filePath of javaFiles) {
    const source = await fs.readFile(filePath, 'utf-8').catch(() => null)
    if (source === null) continue

    // A-ST2: 어노테이션 없는 interface도 게이트 통과시킨다.
    //   - MyBatis @MapperScan 스타일 Repository interface (파일에 @Mapper 없음)
    //   - Service interface (Controller가 주입받는 추상 타입, Impl만 @Service)
    //   파일명 suffix(*Service/*Repository/*Dao/*Mapper) + `interface` 키워드로 1차 게이트.
    const baseName = path.basename(filePath, path.extname(filePath))
    const isNamedInterfaceFile = /(?:Service|Repository|Dao|Mapper)$/.test(baseName)
      && /\binterface\b/.test(source)
    const hasComponent = source.includes('@Service')
      || source.includes('@Component')
      || source.includes('@Repository')
      || source.includes('@Mapper')
      || source.includes('@Controller')
      || source.includes('@RestController')
      // Spring Data interface Repository (어노테이션 없이 extends만 하는 표준 패턴)
      || source.includes('JpaRepository')
      || source.includes('CrudRepository')
      || source.includes('PagingAndSortingRepository')
      || source.includes('MongoRepository')
      || source.includes('ReactiveCrudRepository')
      || isNamedInterfaceFile
    if (!hasComponent) continue

    const relPath = path.relative(repoRoot, filePath).replace(/\\/g, '/')
    const tree = parser.parse(source)

    function walkNode(node: import('web-tree-sitter').SyntaxNode): void {
      // class_declaration: @Service / @Component / @Repository / @Controller 표준
      // interface_declaration: Spring Data JPA `public interface XxxRepository extends JpaRepository<...>`
      //                        (대부분 @Repository 어노테이션은 생략되지만 *Repository 이름 패턴으로 인식)
      const isClass = node.type === 'class_declaration'
      const isInterface = node.type === 'interface_declaration'
      if (isClass || isInterface) {
        let matchedAnnotation: string | undefined
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i)
          if (child === null) continue
          if (child.type === 'modifiers') {
            for (let j = 0; j < child.childCount; j++) {
              const mod = child.child(j)
              if (mod === null || (mod.type !== 'annotation' && mod.type !== 'marker_annotation')) continue
              const annotName = getAnnotationName(mod)
              if (annotName !== undefined && COMPONENT_ANNOTATIONS.has(annotName)) {
                matchedAnnotation = annotName
                break
              }
            }
          }
        }

        const nameNode = node.childForFieldName('name')
        // interface인 경우, 어노테이션 없어도 이름 패턴이면 컴포넌트로 인정.
        // A-ST2: *Service도 포함 — Controller가 주입받는 추상 타입(Impl만 @Service)을 DI 체인 노드로 표현.
        const isNamedInterfaceComponent = isInterface && matchedAnnotation === undefined
          && nameNode !== null
          && /(?:Service|Repository|Dao|Mapper)$/.test(nameNode.text)

        if ((matchedAnnotation !== undefined || isNamedInterfaceComponent) && nameNode !== null) {
          const className = nameNode.text
          const provenance: Provenance = {
            file: relPath,
            line: node.startPosition.row + 1,
            adapter: 'spring-component-parser@0.1',
            analyzerVersion,
          }
          const inferenceTag = matchedAnnotation !== undefined
            ? `spring: @${matchedAnnotation} ${isInterface ? 'interface' : 'class'} ${className} in ${relPath}`
            : `spring: ${className} interface (name pattern, no annotation) in ${relPath}`
          nodes.push(
            createComponentNode({
              id: makeNodeId('component', relPath, className),
              name: className,
              filePath: relPath,
              runtime: 'server',
              provenance,
              confidence: 'inferred',
              inferenceChain: [inferenceTag],
            }),
          )
        }
      }
      for (let i = 0; i < node.childCount; i++) {
        const child = node.child(i)
        if (child !== null) walkNode(child)
      }
    }

    walkNode(tree.rootNode)
  }

  return nodes
}
