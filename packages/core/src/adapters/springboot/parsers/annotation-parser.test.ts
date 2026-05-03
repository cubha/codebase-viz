import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseAnnotations } from './annotation-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-spring-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseAnnotations (SpringBoot)', () => {
  it('.java 없으면 빈 배열 반환', async () => {
    const nodes = await parseAnnotations(tmpDir)
    expect(nodes).toEqual([])
  })

  it('@RestController + @GetMapping("/list") → /list', async () => {
    await writeFile('UserController.java', `
@RestController
public class UserController {
    @GetMapping("/list")
    public List<Object> list() { return null; }
}
`)
    const nodes = await parseAnnotations(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.path).toBe('/list')
    expect(nodes[0]!.dynamicSegmentType).toBe('static')
    expect(nodes[0]!.confidence).toBe('verified')
  })

  it('@RequestMapping 클래스 prefix + @GetMapping 메서드 결합', async () => {
    await writeFile('UserController.java', `
@RestController
@RequestMapping("/api/users")
public class UserController {
    @GetMapping
    public List<Object> list() { return null; }

    @GetMapping("/{userId}")
    public Object get(Long userId) { return null; }
}
`)
    const nodes = await parseAnnotations(tmpDir)
    expect(nodes).toHaveLength(2)
    const paths = nodes.map(n => n.path).sort()
    expect(paths).toContain('/api/users')
    expect(paths).toContain('/api/users/:userId')
    const dynamic = nodes.find(n => n.path.includes(':userId'))
    expect(dynamic!.dynamicSegmentType).toBe('dynamic')
  })

  it('@Controller (비 Rest) 도 감지', async () => {
    await writeFile('PageController.java', `
@Controller
@RequestMapping("/pages")
public class PageController {
    @GetMapping("/home")
    public String home() { return "home"; }
}
`)
    const nodes = await parseAnnotations(tmpDir)
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.path).toBe('/pages/home')
  })

  it('provenance에 adapter="springboot@0.1" 포함', async () => {
    await writeFile('Ctrl.java', `
@RestController
public class Ctrl {
    @GetMapping("/test")
    public void test() {}
}
`)
    const nodes = await parseAnnotations(tmpDir, 'codebase-viz@0.1.0')
    expect(nodes[0]!.provenance.adapter).toBe('springboot@0.1')
    expect(nodes[0]!.provenance.analyzerVersion).toBe('codebase-viz@0.1.0')
  })

  it('@RestController 없으면 경로 수집 안 함', async () => {
    await writeFile('Service.java', `
public class UserService {
    public void doSomething() {}
}
`)
    const nodes = await parseAnnotations(tmpDir)
    expect(nodes).toHaveLength(0)
  })

  it('@GetMapping({"/a", "/b"}) 배열 → 두 RouteNode 생성', async () => {
    await writeFile('PostController.java', `
@RestController
@RequestMapping("/api/posts")
public class PostController {
    @GetMapping({"/featured", "/pinned"})
    public List<Object> getFeaturedOrPinned() { return null; }
}
`)
    const nodes = await parseAnnotations(tmpDir)
    expect(nodes).toHaveLength(2)
    const paths = nodes.map(n => n.path).sort()
    expect(paths).toContain('/api/posts/featured')
    expect(paths).toContain('/api/posts/pinned')
    nodes.forEach(n => expect(n.confidence).toBe('verified'))
  })

  it('value={"/a"} element_value_pair 배열 → RouteNode 생성', async () => {
    await writeFile('AltController.java', `
@RestController
public class AltController {
    @GetMapping(value = {"/items", "/things"})
    public List<Object> list() { return null; }
}
`)
    const nodes = await parseAnnotations(tmpDir)
    expect(nodes).toHaveLength(2)
    const paths = nodes.map(n => n.path).sort()
    expect(paths).toContain('/items')
    expect(paths).toContain('/things')
  })
})
