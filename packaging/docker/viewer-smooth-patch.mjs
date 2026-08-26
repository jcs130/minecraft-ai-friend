// prismarine-viewer web 客户端「丝滑相机」补丁（对已打 follow=smart(v8) + selfhide(v9) 的 bundle 施展）
// 用法: node viewer-smooth-patch.mjs <index.js 路径> <index.html 路径>
// 背景: 2026-08-26 用户反馈人物跟随一卡一卡。根因两层：
//   ① 服务端 tp 间隔 600ms 步子太大（已在 web-panel.mjs 修为 250ms）；
//   ② 客户端相机把每步增量直接 snap（camera.position += delta / target.set），
//      bot 每 600ms 跳一格，相机原样跳 → 视觉一卡一卡。
// 修: 相机位移增量与 OrbitControls target 都改为 170ms Tween 平滑（bundle 内置 tween 库 n 可用；
//     170ms < 250ms 服务端步进，衔接连续）；首摆分支（s 标志）保持直接 set。
// 缓存版本 v=9 -> v=10。
import { readFileSync, writeFileSync } from 'node:fs'

const [, , jsPath, htmlPath] = process.argv
if (!jsPath || !htmlPath) { console.error('usage: node viewer-smooth-patch.mjs <index.js> <index.html>'); process.exit(2) }

const OLD = 'else if(fl){var lt=window.__pvLast;'
  + 'if(lt){u.camera.position.x+=t.x-lt.x;u.camera.position.y+=t.y-lt.y;u.camera.position.z+=t.z-lt.z}'
  + 'else{u.camera.position.set(t.x,t.y+20,t.z+20)}'
  + 'h.target.set(t.x,t.y,t.z)}'

const NEW = 'else if(fl){var lt=window.__pvLast;'
  + 'if(lt){new n.Tween(u.camera.position).to({x:u.camera.position.x+t.x-lt.x,y:u.camera.position.y+t.y-lt.y,z:u.camera.position.z+t.z-lt.z},170).start()}'
  + 'else{u.camera.position.set(t.x,t.y+20,t.z+20)}'
  + 'new n.Tween(h.target).to({x:t.x,y:t.y,z:t.z},170).start()}'

let js = readFileSync(jsPath, 'utf8')
if (js.includes('u.camera.position.x+t.x-lt.x')) {
  console.log('index.js: already smooth, skip')
} else {
  const n = js.split(OLD).length - 1
  if (n !== 1) { console.error(`ABORT: OLD pattern x${n} (expect 1) — bundle 与补丁预期不符`); process.exit(1) }
  js = js.replace(OLD, NEW)
  writeFileSync(jsPath, js)
  console.log(`index.js: smooth camera patched (len ${js.length})`)
}

let html = readFileSync(htmlPath, 'utf8')
if (html.includes('index.js?v=10')) {
  console.log('index.html: already v=10, skip')
} else if (html.includes('index.js?v=9')) {
  writeFileSync(htmlPath, html.replace('index.js?v=9', 'index.js?v=10'))
  console.log('index.html: script -> index.js?v=10')
} else {
  console.error('ABORT: index.html script tag 不符预期（应含 index.js?v=9）'); process.exit(1)
}
