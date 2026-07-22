import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseMapperXmlEdges } from './mapper-xml-parser.js'
import { parseSpringComponents } from './component-parser.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-mapper-xml-'))
})
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseMapperXmlEdges', () => {
  it('componentNodes 없으면 빈 결과', async () => {
    const r = await parseMapperXmlEdges(tmpDir, [], 'test')
    expect(r.xmlNodes).toEqual([])
    expect(r.xmlEdges).toEqual([])
  })

  it('namespace FQN ↔ Repository 정확 매칭 → XML 노드 + Repository→XML 엣지', async () => {
    await writeFile('src/main/java/com/x/repo/UserRepository.java', `
package com.x.repo;
public interface UserRepository {}
`)
    await writeFile('src/main/resources/mapper/UserMapper.xml', `
<mapper namespace="com.x.repo.UserRepository">
  <select id="findAll">SELECT * FROM USERS</select>
</mapper>
`)
    const comps = await parseSpringComponents(tmpDir, 'test')
    const r = await parseMapperXmlEdges(tmpDir, comps, 'test')
    expect(r.xmlNodes.map(n => n.name)).toContain('UserMapper.xml')
    const repo = comps.find(c => c.name === 'UserRepository')!
    const xml = r.xmlNodes.find(n => n.name === 'UserMapper.xml')!
    const edge = r.xmlEdges.find(e => e.from === repo.id && e.to === xml.id)
    expect(edge).toBeDefined()
    expect(edge?.kind).toBe('calls')
  })

  it('namespace가 어떤 컴포넌트와도 매칭 안 되면 침묵 (Less is More)', async () => {
    await writeFile('src/main/java/com/x/repo/UserRepository.java', `
package com.x.repo;
public interface UserRepository {}
`)
    await writeFile('src/main/resources/mapper/GhostMapper.xml', `
<mapper namespace="com.ghost.NoSuchRepository">
  <select id="x">SELECT 1</select>
</mapper>
`)
    const comps = await parseSpringComponents(tmpDir, 'test')
    const r = await parseMapperXmlEdges(tmpDir, comps, 'test')
    expect(r.xmlNodes).toEqual([])
    expect(r.xmlEdges).toEqual([])
  })

  it('C1: select/insert/update/delete statement를 XML 아래 자식 노드로 노출한다', async () => {
    await writeFile('src/main/java/com/x/repo/UserRepository.java', `
package com.x.repo;
public interface UserRepository {}
`)
    await writeFile('src/main/resources/mapper/UserMapper.xml', `
<mapper namespace="com.x.repo.UserRepository">
  <select id="findAll">SELECT * FROM USERS</select>
  <select id="findById" parameterType="long">SELECT * FROM USERS WHERE id = #{id}</select>
  <insert id="insert">INSERT INTO USERS (name) VALUES (#{name})</insert>
  <update id="update">UPDATE USERS SET name = #{name} WHERE id = #{id}</update>
  <delete id="remove">DELETE FROM USERS WHERE id = #{id}</delete>
</mapper>
`)
    const comps = await parseSpringComponents(tmpDir, 'test')
    const r = await parseMapperXmlEdges(tmpDir, comps, 'test')
    const xml = r.xmlNodes.find(n => n.name === 'UserMapper.xml')!

    const stmtNames = r.xmlNodes.map(n => n.name).filter(n => n !== 'UserMapper.xml')
    expect(stmtNames.sort()).toEqual([
      'findAll [SELECT]',
      'findById [SELECT]',
      'insert [INSERT]',
      'remove [DELETE]',
      'update [UPDATE]',
    ])

    for (const stmt of r.xmlNodes.filter(n => n.name !== 'UserMapper.xml')) {
      const edge = r.xmlEdges.find(e => e.from === xml.id && e.to === stmt.id)
      expect(edge, `${stmt.name} 엣지 없음`).toBeDefined()
      expect(edge?.kind).toBe('calls')
      expect(edge?.confidence).toBe('verified')
    }
  })

  it('C1: 같은 id의 statement가 재등장해도 중복 노드를 만들지 않는다', async () => {
    await writeFile('src/main/java/com/x/repo/UserRepository.java', `
package com.x.repo;
public interface UserRepository {}
`)
    await writeFile('src/main/resources/mapper/UserMapper.xml', `
<mapper namespace="com.x.repo.UserRepository">
  <select id="findAll">SELECT * FROM USERS</select>
  <select id="findAll">SELECT * FROM USERS WHERE active = 1</select>
</mapper>
`)
    const comps = await parseSpringComponents(tmpDir, 'test')
    const r = await parseMapperXmlEdges(tmpDir, comps, 'test')
    expect(r.xmlNodes.filter(n => n.name === 'findAll [SELECT]')).toHaveLength(1)
  })

  it('mini-spring-lombok-mybatis-app fixture — 3 XML ↔ 3 Repository 매칭 (A-ST3)', async () => {
    const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-spring-lombok-mybatis-app')
    const comps = await parseSpringComponents(FIXTURE, 'test')
    const r = await parseMapperXmlEdges(FIXTURE, comps, 'test')
    const names = (id: string) => [...comps, ...r.xmlNodes].find(c => c.id === id)?.name
    const has = (from: string, to: string) => r.xmlEdges.some(e => names(e.from) === from && names(e.to) === to)
    expect(has('CommonPopRepository', 'CommonPopMapper.xml')).toBe(true)
    expect(has('OrderRepository', 'OrderMapper.xml')).toBe(true)
    expect(has('PerfStatusRepository', 'PerfStatusMapper.xml')).toBe(true)
  })
})
