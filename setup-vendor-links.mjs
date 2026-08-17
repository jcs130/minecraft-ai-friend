#!/usr/bin/env node
// 修复/重建 node_modules/@deepseek-ai/* 链接（任何 `npm install` 都会把它们抹掉）。
// 这些包住在 dsh monorepo（vendor/ + packages/core/）里，不发布到 npm——
// 所以本仓库必须放在 deepseek-harness 检出目录内（默认 ../）。
// 跨平台：Windows 用 junction（无需管理员权限），posix 用 symlink。幂等，可反复运行。
import { symlink, mkdir, access, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
// Node 会把模块路径 realpath 化（junction 部署解析回真实路径），所以同时探测 cwd 链。
const isHarness = (p) => existsSync(path.join(p, 'vendor', 'cordis', 'package.json'))
const harnessRoot = process.env.DSH_ROOT
  ? path.resolve(process.env.DSH_ROOT)
  : [path.resolve(process.cwd(), '..'), path.resolve(here, '..')].find(isHarness)

const LINKS = [
  ['cordis', 'vendor/cordis'],
  ['schemastery', 'vendor/schemastery'],
  ['cordis-plugin-timer', 'vendor/timer'],
  ['dsh-system-prompt', 'packages/core/system-prompt'],
  ['dsh-tools', 'packages/core/tools'],
]

if (!existsSync(path.join(harnessRoot, 'package.json'))) {
  console.error(`✗ harness root not found: ${harnessRoot}`)
  console.error('  本仓库必须放在 deepseek-harness 检出目录内，或设置 DSH_ROOT 指向它。')
  process.exit(1)
}

const scopeDir = path.join(here, 'node_modules', '@deepseek-ai')
await mkdir(scopeDir, { recursive: true })

let created = 0, present = 0, failed = 0
for (const [name, rel] of LINKS) {
  const target = path.join(harnessRoot, rel)
  const link = path.join(scopeDir, name)
  if (!existsSync(target)) {
    console.error(`✗ ${name}: harness 里找不到 ${rel}`)
    failed++
    continue
  }
  if (existsSync(link)) {
    try {
      await access(path.join(link, 'package.json'))
      console.log(`· ${name} 已就绪`)
      present++
      continue
    } catch {
      await rm(link, { recursive: true, force: true }) // 坏链接，重建
    }
  }
  try {
    await symlink(target, link, process.platform === 'win32' ? 'junction' : 'dir')
    console.log(`✓ ${name} -> ${path.relative(here, target)}`)
    created++
  } catch (e) {
    console.error(`✗ ${name}: ${e.message}`)
    failed++
  }
}

console.log(`vendor links ready（新建 ${created}，已存在 ${present}，失败 ${failed}）`)
if (failed > 0) process.exit(1)

// native 三件套提示（prismarine-viewer 无头渲染用；不开 viewer 可跳过）
const hasNative = existsSync(path.join(here, 'node_modules', 'node-canvas-webgl'))
if (!hasNative) {
  console.log('')
  console.log('提示：想开 3D 观察视角（MC_VIEWER≠0）需要 native 渲染模块：')
  console.log('  npm i --no-save --legacy-peer-deps node-canvas-webgl canvas@3.2.3 gl')
  console.log('  （gl 在部分平台需编译环境；装不上就用 MC_VIEWER=0 无头跑，功能不受影响）')
}
