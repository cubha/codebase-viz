import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { springBootAdapter } from './adapter.js'
import type { StackInfo } from '@codebase-viz/types'

let tmpDir: string

const STACK: StackInfo = {
  framework: 'springboot',
  hasSupabase: false,
  hasPrisma: false,
  hasDexie: false,
  hasDrizzle: false,
  hasTypeOrm: false,
  hasSQLAlchemy: false,
  hasDjangoORM: false,
  hasSpringDataJpa: false,
  isMonorepo: false,
  appDirs: [],
  parsingLevel: 'L2',
  llmRecommended: false,
}

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'codebase-viz-springboot-adapter-'))
})
afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

async function writeFile(relPath: string, content: string): Promise<void> {
  const absPath = path.join(tmpDir, relPath)
  await fs.mkdir(path.dirname(absPath), { recursive: true })
  await fs.writeFile(absPath, content, 'utf-8')
}

describe('SpringBootAdapter — Feign 클라이언트 이름충돌 방어 (C3, scope-critic 지적)', () => {
  it('일반 컴포넌트와 이름이 같은 @FeignClient는 조용히 제외한다(거짓 DI 엣지 방지)', async () => {
    // 이름이 우연히 겹치는 두 파일: 실제 @Service와 동명의 @FeignClient interface.
    await writeFile('src/main/java/com/x/service/PaymentClient.java', `
package com.x.service;
import org.springframework.stereotype.Service;

@Service
public class PaymentClient {}
`)
    await writeFile('src/main/java/com/x/external/PaymentClient.java', `
package com.x.external;
import org.springframework.cloud.openfeign.FeignClient;

@FeignClient(name = "payment-service")
public interface PaymentClient {}
`)

    const result = await springBootAdapter.analyze({ repoRoot: tmpDir, analyzerVersion: 'test', stack: STACK })

    const paymentClients = result.componentNodes.filter(n => n.name === 'PaymentClient')
    // 실제 @Service 하나만 유지 — Feign 쪽은 이름 충돌로 제외됐어야 한다.
    expect(paymentClients).toHaveLength(1)
    expect(paymentClients[0]?.provenance.adapter).not.toBe('external-call-extractor@0.1')
  })

  it('이름 충돌이 없으면 Feign 클라이언트를 정상 등록한다', async () => {
    await writeFile('src/main/java/com/x/external/OrderServiceClient.java', `
package com.x.external;
import org.springframework.cloud.openfeign.FeignClient;

@FeignClient(name = "order-service")
public interface OrderServiceClient {}
`)

    const result = await springBootAdapter.analyze({ repoRoot: tmpDir, analyzerVersion: 'test', stack: STACK })

    const feignNode = result.componentNodes.find(n => n.name === 'OrderServiceClient')
    expect(feignNode).toBeDefined()
    expect(feignNode?.provenance.adapter).toBe('external-call-extractor@0.1')
  })
})
