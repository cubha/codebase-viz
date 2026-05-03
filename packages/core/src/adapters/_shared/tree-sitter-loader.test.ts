import { describe, it, expect } from 'vitest'
import { getPythonLanguage, getJavaLanguage, createPythonParser, createJavaParser } from './tree-sitter-loader.js'

describe('tree-sitter-loader', () => {
  it('getPythonLanguage — idempotent (동일 객체 반환)', async () => {
    const lang1 = await getPythonLanguage()
    const lang2 = await getPythonLanguage()
    expect(lang1).toBe(lang2)
  })

  it('getJavaLanguage — idempotent', async () => {
    const lang1 = await getJavaLanguage()
    const lang2 = await getJavaLanguage()
    expect(lang1).toBe(lang2)
  })

  it('createPythonParser — 간단한 소스 파싱 성공', async () => {
    const parser = await createPythonParser()
    const tree = parser.parse('x = 1')
    expect(tree).not.toBeNull()
    expect(tree!.rootNode.type).toBe('module')
  })

  it('createJavaParser — 간단한 소스 파싱 성공', async () => {
    const parser = await createJavaParser()
    const tree = parser.parse('public class Hello {}')
    expect(tree).not.toBeNull()
    expect(tree!.rootNode.type).toBe('program')
  })
})
