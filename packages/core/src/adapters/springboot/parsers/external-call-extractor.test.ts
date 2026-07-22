import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseFeignClients, EXTERNAL_CALL_ADAPTER_TAG } from './external-call-extractor.js'
import { parseSpringComponents } from './component-parser.js'
import { parseSpringDependencies } from './di-parser.js'

let tmpDir: string

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-feign-'))
})
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('parseFeignClients (C3)', () => {
  it('Java 파일 없으면 빈 배열', async () => {
    expect(await parseFeignClients(tmpDir, 'test')).toEqual([])
  })

  it('@FeignClient(name="...") 인터페이스를 ComponentNode로 등록한다', async () => {
    await writeFile('UserServiceClient.java', `
import org.springframework.cloud.openfeign.FeignClient;

@FeignClient(name = "user-service")
public interface UserServiceClient {
  String ping();
}
`)
    const nodes = await parseFeignClients(tmpDir, 'test')
    expect(nodes).toHaveLength(1)
    expect(nodes[0]?.name).toBe('UserServiceClient')
    expect(nodes[0]?.provenance.adapter).toBe(EXTERNAL_CALL_ADAPTER_TAG)
    expect(nodes[0]?.confidence).toBe('verified')
  })

  it('@FeignClient("name") 단일 위치 인자 형태도 인식한다', async () => {
    await writeFile('OrderServiceClient.java', `
@FeignClient("order-service")
public interface OrderServiceClient {}
`)
    const nodes = await parseFeignClients(tmpDir, 'test')
    expect(nodes.map(n => n.name)).toEqual(['OrderServiceClient'])
  })

  it('@FeignClient 없는 일반 interface/class는 등록하지 않는다', async () => {
    await writeFile('PlainRepository.java', `
public interface PlainRepository {}
`)
    await writeFile('PlainService.java', `
public class PlainService {}
`)
    expect(await parseFeignClients(tmpDir, 'test')).toEqual([])
  })

  it('이름에 접미사를 붙이지 않는다(di-parser 타입명 매칭 유지 목적)', async () => {
    await writeFile('PaymentClient.java', `
@FeignClient(url = "http://payments.internal")
public interface PaymentClient {}
`)
    const nodes = await parseFeignClients(tmpDir, 'test')
    expect(nodes[0]?.name).toBe('PaymentClient')
  })
})

describe('Feign 클라이언트 DI 자동 연결 (adapter.ts 병합 전제 재현)', () => {
  it('Feign 인터페이스를 componentNodes에 먼저 합치면 di-parser가 기존 이름매칭으로 calls 엣지를 자동 생성한다', async () => {
    await writeFile('UserServiceClient.java', `
@FeignClient(name = "user-service")
public interface UserServiceClient {}
`)
    await writeFile('OrderService.java', `
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class OrderService {
    @Autowired
    private UserServiceClient userServiceClient;
}
`)
    const springComponents = await parseSpringComponents(tmpDir, 'test')
    const feignNodes = await parseFeignClients(tmpDir, 'test')
    // adapter.ts와 동일 순서: Feign 노드를 먼저 합친 뒤 di-parser에 전달.
    const merged = [...springComponents, ...feignNodes]
    const edges = await parseSpringDependencies(tmpDir, merged, 'test')

    const orderSvc = merged.find(c => c.name === 'OrderService')!
    const feignClient = merged.find(c => c.name === 'UserServiceClient')!
    expect(feignClient.provenance.adapter).toBe(EXTERNAL_CALL_ADAPTER_TAG)
    const edge = edges.find(e => e.from === orderSvc.id && e.to === feignClient.id)
    expect(edge).toBeDefined()
    expect(edge?.kind).toBe('calls')
  })
})
