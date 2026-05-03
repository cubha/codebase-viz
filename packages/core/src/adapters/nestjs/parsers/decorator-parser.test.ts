import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { parseControllers, parseModulesAndProviders } from './decorator-parser.js'

let tmpDir: string

const USERS_CONTROLLER = `
import { Controller, Get, Post, Delete } from '@nestjs/common'

@Controller('users')
export class UsersController {
  @Get()
  findAll() { return [] }

  @Get(':id')
  findOne() { return null }

  @Post()
  create() { return {} }

  @Delete(':id')
  remove() { return {} }
}
`.trim()

const USERS_SERVICE = `
import { Injectable } from '@nestjs/common'

@Injectable()
export class UsersService {
  list() { return [] }
}
`.trim()

const USERS_MODULE = `
import { Module } from '@nestjs/common'
import { UsersController } from './users.controller'
import { UsersService } from './users.service'

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
`.trim()

const APP_MODULE = `
import { Module } from '@nestjs/common'
import { UsersModule } from './users/users.module'

@Module({
  imports: [UsersModule],
})
export class AppModule {}
`.trim()

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'nestjs-parser-'))
  await fs.mkdir(path.join(tmpDir, 'src', 'users'), { recursive: true })
  await fs.writeFile(path.join(tmpDir, 'src', 'users', 'users.controller.ts'), USERS_CONTROLLER)
  await fs.writeFile(path.join(tmpDir, 'src', 'users', 'users.service.ts'), USERS_SERVICE)
  await fs.writeFile(path.join(tmpDir, 'src', 'users', 'users.module.ts'), USERS_MODULE)
  await fs.writeFile(path.join(tmpDir, 'src', 'app.module.ts'), APP_MODULE)
})

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('parseControllers', () => {
  it('@Controller("users") + @Get/@Post/@Delete → 4개 RouteNode 생성', async () => {
    const { routes, controllers } = await parseControllers(tmpDir)

    expect(routes).toHaveLength(4)
    expect(controllers).toHaveLength(1)

    const paths = routes.map(r => r.path).sort()
    expect(paths).toEqual(['/users', '/users', '/users/:id', '/users/:id'])

    const dynamicCount = routes.filter(r => r.dynamicSegmentType === 'dynamic').length
    expect(dynamicCount).toBe(2)

    expect(routes.every(r => r.routeFileKind === 'page')).toBe(true)
    expect(routes.every(r => r.renderingMode === 'SSR')).toBe(true)
    expect(routes.every(r => r.confidence === 'verified')).toBe(true)
  })

  it('controller node에 className + runtime: server 부여', async () => {
    const { controllers } = await parseControllers(tmpDir)
    const c = controllers[0]
    expect(c?.name).toBe('UsersController')
    expect(c?.runtime).toBe('server')
    expect(c?.confidence).toBe('verified')
  })

  it('각 RouteNode의 NodeId는 className.methodName 으로 unique', async () => {
    const { routes } = await parseControllers(tmpDir)
    const ids = new Set(routes.map(r => r.id))
    expect(ids.size).toBe(routes.length)
  })

  it('provenance.adapter = nestjs@0.1', async () => {
    const { routes, controllers } = await parseControllers(tmpDir)
    expect(routes.every(r => r.provenance.adapter === 'nestjs@0.1')).toBe(true)
    expect(controllers.every(c => c.provenance.adapter === 'nestjs@0.1')).toBe(true)
  })
})

describe('parseModulesAndProviders', () => {
  it('@Module 2개 + @Injectable 1개 추출', async () => {
    const { modules, services } = await parseModulesAndProviders(tmpDir)
    expect(modules).toHaveLength(2)
    expect(services).toHaveLength(1)

    const moduleNames = modules.map(m => m.name).sort()
    expect(moduleNames).toEqual(['AppModule', 'UsersModule'])
    expect(services[0]?.name).toBe('UsersService')
  })

  it('UsersModule → UsersController/UsersService edges + AppModule → UsersModule edge', async () => {
    const { edges } = await parseModulesAndProviders(tmpDir)
    expect(edges.length).toBeGreaterThanOrEqual(3)

    const edgeKinds = new Set(edges.map(e => e.kind))
    expect(edgeKinds).toEqual(new Set(['imports']))

    expect(edges.every(e => e.confidence === 'verified')).toBe(true)
    expect(edges.every(e => e.provenance.adapter === 'nestjs@0.1')).toBe(true)
  })
})
