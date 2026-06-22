import { describe, it, expect } from 'vitest'
import type { IRGraphMetadata } from '@codebase-viz/types'
import { metadataToInfra } from './infra.js'

function meta(over: Partial<IRGraphMetadata> & { framework: string }): IRGraphMetadata {
  return {
    hasSupabase: false,
    hasPrisma: false,
    hasDexie: false,
    hasFirebase: false,
    ...over,
  }
}

describe('metadataToInfra — hasExpo (v1.2.54 Fix1: deployTarget 뒷문 차단)', () => {
  it('정적 어댑터 framework가 react-router면 deployTarget=mobile이어도 hasExpo=false', () => {
    // LLM이 deployTarget='mobile'을 발명해도 정적 framework 가드를 우회하지 못해야 한다.
    const infra = metadataToInfra(meta({ framework: 'react-router', deployTarget: 'mobile' }))
    expect(infra.hasExpo).toBe(false)
    expect(infra.hasReactRouter).toBe(true)
  })

  it('진짜 Expo(framework=expo)는 deployTarget 없이도 hasExpo=true (무손실)', () => {
    // stack-detector:79가 expo deps를 정적 감지해 framework=expo로 설정 → 무손실.
    const infra = metadataToInfra(meta({ framework: 'expo' }))
    expect(infra.hasExpo).toBe(true)
  })

  it('framework=expo + deployTarget=mobile도 hasExpo=true 유지', () => {
    const infra = metadataToInfra(meta({ framework: 'expo', deployTarget: 'mobile' }))
    expect(infra.hasExpo).toBe(true)
  })

  it('nextjs는 deployTarget=mobile 환각에도 hasExpo=false', () => {
    const infra = metadataToInfra(meta({ framework: 'nextjs-app-router', deployTarget: 'mobile' }))
    expect(infra.hasExpo).toBe(false)
    expect(infra.hasNextjs).toBe(true)
  })
})
