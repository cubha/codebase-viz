#!/usr/bin/env node
// Spring Boot fixture 생성기 — 대규모 라우트 수동 검증용 (chunk/grid 회귀).
// 10 modules × 5 resources × 5 actions = 250 routes.
import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.resolve(__dirname, '..', 'fixtures', 'mini-spring-large-app')
const PKG_BASE = 'com/example'
const SRC = path.join(OUT, 'src', 'main', 'java', PKG_BASE)

const MODULES = [
  'admin', 'auth', 'billing', 'catalog', 'customer',
  'employee', 'inventory', 'notification', 'order', 'product',
]
const RESOURCES = ['users', 'roles', 'permissions', 'logs', 'reports']

function pascal(s) { return s.charAt(0).toUpperCase() + s.slice(1) }

function controllerCode(module, resource) {
  const C = pascal(module) + pascal(resource) + 'Controller'
  return `package com.example.controller.${module};

import org.springframework.web.bind.annotation.*;
import java.util.List;

@RestController
@RequestMapping("/api/v1/${module}/${resource}")
public class ${C} {

    @GetMapping
    public List<Object> list() {
        return List.of();
    }

    @GetMapping("/{id}")
    public Object getOne(@PathVariable Long id) {
        return null;
    }

    @PostMapping
    public Object create(@RequestBody Object body) {
        return null;
    }

    @PutMapping("/{id}")
    public Object update(@PathVariable Long id, @RequestBody Object body) {
        return null;
    }

    @DeleteMapping("/{id}")
    public void remove(@PathVariable Long id) {
    }
}
`
}

const APP = `package com.example;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class Application {
    public static void main(String[] args) {
        SpringApplication.run(Application.class, args);
    }
}
`

const POM = `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.example</groupId>
  <artifactId>mini-spring-large-app</artifactId>
  <version>0.0.1-SNAPSHOT</version>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>3.2.0</version>
    </dependency>
  </dependencies>
</project>
`

// ─── 생성 ────────────────────────────────────────────────────────────────────
fs.rmSync(OUT, { recursive: true, force: true })
fs.mkdirSync(SRC, { recursive: true })
fs.writeFileSync(path.join(OUT, 'pom.xml'), POM)
fs.writeFileSync(path.join(SRC, 'Application.java'), APP)

let count = 0
for (const m of MODULES) {
  const dir = path.join(SRC, 'controller', m)
  fs.mkdirSync(dir, { recursive: true })
  for (const r of RESOURCES) {
    fs.writeFileSync(
      path.join(dir, `${pascal(m)}${pascal(r)}Controller.java`),
      controllerCode(m, r),
    )
    count++
  }
}

console.log(`✅ ${count} controllers × 5 endpoints = ${count * 5} routes 생성 완료`)
console.log(`   경로: ${OUT}`)
