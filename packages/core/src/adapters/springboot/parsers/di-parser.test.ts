import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { parseSpringDependencies } from './di-parser.js'
import { parseSpringComponents } from './component-parser.js'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-spring-di-'))
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseSpringDependencies', () => {
  it('Java 파일 없으면 빈 배열 반환', async () => {
    const edges = await parseSpringDependencies(tmpDir, [], 'test')
    expect(edges).toEqual([])
  })

  it('componentNodes 없으면 빈 배열 반환', async () => {
    await writeFile('UserController.java', `
@RestController
public class UserController {}
`)
    const edges = await parseSpringDependencies(tmpDir, [], 'test')
    expect(edges).toEqual([])
  })

  it('필드 주입: @Autowired 필드 → calls 엣지 생성', async () => {
    await writeFile('UserRepository.java', `
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {}
`)
    await writeFile('UserService.java', `
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;
}
`)
    const components = await parseSpringComponents(tmpDir, 'test')
    const edges = await parseSpringDependencies(tmpDir, components, 'test')

    expect(edges).toHaveLength(1)
    expect(edges[0]?.kind).toBe('calls')
    expect(edges[0]?.confidence).toBe('inferred')
    const fromId = components.find(c => c.name === 'UserService')?.id
    const toId = components.find(c => c.name === 'UserRepository')?.id
    expect(edges[0]?.from).toBe(fromId)
    expect(edges[0]?.to).toBe(toId)
  })

  it('생성자 주입: 단일 생성자 → calls 엣지 생성', async () => {
    await writeFile('UserService.java', `
import org.springframework.stereotype.Service;

@Service
public class UserService {}
`)
    await writeFile('UserController.java', `
import org.springframework.web.bind.annotation.RestController;

@RestController
public class UserController {
    private final UserService userService;

    public UserController(UserService userService) {
        this.userService = userService;
    }
}
`)
    const components = await parseSpringComponents(tmpDir, 'test')
    const edges = await parseSpringDependencies(tmpDir, components, 'test')

    expect(edges).toHaveLength(1)
    expect(edges[0]?.kind).toBe('calls')
    const fromId = components.find(c => c.name === 'UserController')?.id
    const toId = components.find(c => c.name === 'UserService')?.id
    expect(edges[0]?.from).toBe(fromId)
    expect(edges[0]?.to).toBe(toId)
  })

  it('setter 주입: @Autowired setter → calls 엣지 생성', async () => {
    await writeFile('PostRepository.java', `
import org.springframework.stereotype.Repository;

@Repository
public class PostRepository {}
`)
    await writeFile('PostService.java', `
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class PostService {
    private PostRepository postRepository;

    @Autowired
    public void setPostRepository(PostRepository postRepository) {
        this.postRepository = postRepository;
    }
}
`)
    const components = await parseSpringComponents(tmpDir, 'test')
    const edges = await parseSpringDependencies(tmpDir, components, 'test')

    expect(edges).toHaveLength(1)
    expect(edges[0]?.kind).toBe('calls')
    const fromId = components.find(c => c.name === 'PostService')?.id
    const toId = components.find(c => c.name === 'PostRepository')?.id
    expect(edges[0]?.from).toBe(fromId)
    expect(edges[0]?.to).toBe(toId)
  })

  it('알 수 없는 타입은 엣지 생성 안 함 (Less is More)', async () => {
    await writeFile('UserService.java', `
import org.springframework.stereotype.Service;

@Service
public class UserService {
    @org.springframework.beans.factory.annotation.Autowired
    private ExternalClient externalClient;
}
`)
    const components = await parseSpringComponents(tmpDir, 'test')
    const edges = await parseSpringDependencies(tmpDir, components, 'test')
    expect(edges).toEqual([])
  })

  it('동일 쌍 중복 엣지 방지', async () => {
    await writeFile('UserRepository.java', `
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {}
`)
    await writeFile('UserService.java', `
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    @Autowired
    private UserRepository userRepo1;
    @Autowired
    private UserRepository userRepo2;
}
`)
    const components = await parseSpringComponents(tmpDir, 'test')
    const edges = await parseSpringDependencies(tmpDir, components, 'test')
    expect(edges).toHaveLength(1)
  })

  it('inferenceChain 포함 확인', async () => {
    await writeFile('UserRepository.java', `
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {}
`)
    await writeFile('UserService.java', `
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class UserService {
    @Autowired
    private UserRepository userRepository;
}
`)
    const components = await parseSpringComponents(tmpDir, 'test')
    const edges = await parseSpringDependencies(tmpDir, components, 'test')
    expect(edges[0]?.confidence).toBe('inferred')
    if (edges[0]?.confidence === 'inferred') {
      expect(edges[0].inferenceChain.length).toBeGreaterThan(0)
      expect(edges[0].inferenceChain[0]).toContain('UserService')
      expect(edges[0].inferenceChain[0]).toContain('UserRepository')
    }
  })

  it('mini-spring-di-app fixture — 3종 DI 패턴 모두 감지', async () => {
    const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-spring-di-app')
    const components = await parseSpringComponents(FIXTURE, 'test')
    const edges = await parseSpringDependencies(FIXTURE, components, 'test')

    const names = (id: string) => components.find(c => c.id === id)?.name

    // 생성자 주입: UserController → UserService
    const ctorEdge = edges.find(
      e => names(e.from) === 'UserController' && names(e.to) === 'UserService',
    )
    expect(ctorEdge).toBeDefined()

    // 필드 주입: UserService → UserRepository
    const fieldEdge = edges.find(
      e => names(e.from) === 'UserService' && names(e.to) === 'UserRepository',
    )
    expect(fieldEdge).toBeDefined()

    // setter 주입: PostService → PostRepository
    const setterEdge = edges.find(
      e => names(e.from) === 'PostService' && names(e.to) === 'PostRepository',
    )
    expect(setterEdge).toBeDefined()

    expect(edges.every(e => e.kind === 'calls')).toBe(true)
  })

  it('Lombok @RequiredArgsConstructor: final 필드 → calls 엣지 (A-ST1)', async () => {
    await writeFile('CommonPopService.java', `
package x;
public interface CommonPopService {}
`)
    await writeFile('CommonPopController.java', `
package x;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequiredArgsConstructor
public class CommonPopController {
    private final CommonPopService commonPopService;
}
`)
    const components = await parseSpringComponents(tmpDir, 'test')
    const edges = await parseSpringDependencies(tmpDir, components, 'test')
    const names = (id: string) => components.find(c => c.id === id)?.name
    const e = edges.find(x => names(x.from) === 'CommonPopController' && names(x.to) === 'CommonPopService')
    expect(e).toBeDefined()
  })

  it('Lombok 없는 final 필드는 주입 아님 (Less is More, A-ST1)', async () => {
    await writeFile('FooRepository.java', `
package x;
public interface FooRepository {}
`)
    await writeFile('FooService.java', `
package x;
import org.springframework.stereotype.Service;

@Service
public class FooService {
    private final FooRepository fooRepository = null;
}
`)
    const components = await parseSpringComponents(tmpDir, 'test')
    const edges = await parseSpringDependencies(tmpDir, components, 'test')
    expect(edges).toHaveLength(0)
  })

  it('implements: ServiceImpl → 구현 interface 역방향 calls 엣지 (interface→Impl, A-ST1)', async () => {
    await writeFile('CommonPopService.java', `
package x;
public interface CommonPopService {}
`)
    await writeFile('CommonPopServiceImpl.java', `
package x;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class CommonPopServiceImpl implements CommonPopService {}
`)
    const components = await parseSpringComponents(tmpDir, 'test')
    const edges = await parseSpringDependencies(tmpDir, components, 'test')
    const names = (id: string) => components.find(c => c.id === id)?.name
    const e = edges.find(x => names(x.from) === 'CommonPopService' && names(x.to) === 'CommonPopServiceImpl')
    expect(e).toBeDefined()
    expect(e?.confidence).toBe('inferred')
    if (e?.confidence === 'inferred') {
      expect(e.inferenceChain.some((c: string) => /implements/i.test(c))).toBe(true)
    }
  })

  it('mini-spring-lombok-mybatis-app fixture — 5단 체인 엣지 모두 감지 (A-ST1)', async () => {
    const FIXTURE = path.resolve(process.cwd(), 'fixtures/mini-spring-lombok-mybatis-app')
    const components = await parseSpringComponents(FIXTURE, 'test')
    const edges = await parseSpringDependencies(FIXTURE, components, 'test')
    const names = (id: string) => components.find(c => c.id === id)?.name
    const has = (from: string, to: string) => edges.some(e => names(e.from) === from && names(e.to) === to)
    // Controller → 다중 Service (인라인)
    expect(has('CommonPopController', 'CommonPopService')).toBe(true)
    expect(has('CommonPopController', 'PerfStatusService')).toBe(true)
    // Service(interface) → ServiceImpl
    expect(has('CommonPopService', 'CommonPopServiceImpl')).toBe(true)
    expect(has('PerfStatusService', 'PerfStatusServiceImpl')).toBe(true)
    // ServiceImpl → 다중 Repository (fan-out)
    expect(has('CommonPopServiceImpl', 'CommonPopRepository')).toBe(true)
    expect(has('CommonPopServiceImpl', 'OrderRepository')).toBe(true)
    expect(has('PerfStatusServiceImpl', 'PerfStatusRepository')).toBe(true)
  })
})
