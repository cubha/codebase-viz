import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseSpringComponents } from './component-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-spring-comp-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseSpringComponents', () => {
  it('.java 파일 없으면 빈 배열 반환', async () => {
    const nodes = await parseSpringComponents(tmpDir, 'test')
    expect(nodes).toEqual([])
  })

  it('@Service 클래스 추출', async () => {
    await writeFile('UserService.java', `
import org.springframework.stereotype.Service;

@Service
public class UserService {
    public String findAll() { return ""; }
}
`)
    const nodes = await parseSpringComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('UserService')
    expect(nodes[0]?.runtime).toBe('server')
    expect(nodes[0]?.confidence).toBe('inferred')
  })

  it('@Repository 클래스 추출', async () => {
    await writeFile('UserRepository.java', `
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {
}
`)
    const nodes = await parseSpringComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('UserRepository')
  })

  it('@Component 클래스 추출', async () => {
    await writeFile('EventHandler.java', `
import org.springframework.stereotype.Component;

@Component
public class EventHandler {
}
`)
    const nodes = await parseSpringComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('EventHandler')
  })

  it('Spring 어노테이션 없는 클래스는 추출 안 됨', async () => {
    await writeFile('Helper.java', `
public class Helper {
    public static String format(String s) { return s; }
}
`)
    const nodes = await parseSpringComponents(tmpDir, 'test')
    expect(nodes).toEqual([])
  })

  it('복수 컴포넌트 모두 추출', async () => {
    await writeFile('UserService.java', `
import org.springframework.stereotype.Service;
import org.springframework.stereotype.Repository;

@Service
public class UserService {}
`)
    await writeFile('PostRepository.java', `
import org.springframework.stereotype.Repository;

@Repository
public class PostRepository {}
`)
    const nodes = await parseSpringComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(2)
    expect(nodes.map(n => n.name)).toEqual(expect.arrayContaining(['UserService', 'PostRepository']))
  })

  it('NodeId가 결정론적으로 생성됨', async () => {
    await writeFile('src/UserService.java', `
import org.springframework.stereotype.Service;

@Service
public class UserService {}
`)
    const nodes = await parseSpringComponents(tmpDir, 'test')
    expect(nodes[0]?.id).toBe('component:src/UserService.java:UserService')
  })

  it('@Controller 클래스 추출', async () => {
    await writeFile('UserController.java', `
import org.springframework.stereotype.Controller;

@Controller
public class UserController {
}
`)
    const nodes = await parseSpringComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('UserController')
    expect(nodes[0]?.runtime).toBe('server')
  })

  it('@RestController 클래스 추출', async () => {
    await writeFile('ApiController.java', `
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ApiController {
}
`)
    const nodes = await parseSpringComponents(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('ApiController')
  })

  it('mini-spring-app fixture — Controller/Service 모두 추출', async () => {
    const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-spring-app')
    const nodes = await parseSpringComponents(FIXTURE, 'test')
    const names = nodes.map(n => n.name)
    expect(names).toContain('UserController')
    expect(names).toContain('PostController')
    expect(names).toContain('UserService')
  })
})
