// prismarine-viewer web 客户端「化身隐身」补丁（对已打 follow=smart 补丁的 bundle 施展）
// 用法: node viewer-selfhide-patch.mjs <index.js 路径> <index.html 路径>
// 背景: 天眼观察者(Goddess)第三人称下, viewer 本地渲染自己的玩家 mesh("小人"),
//       无视 spectator/gamemode → 面板里一个悬空小人干扰看角色。
//       (世界里 spectator 本就隐身, 这里只补 viewer 自己的渲染。)
// 修: mesh 创建后 e.visible=!1 —— 小人不再出现; 缓存版本 v=8 -> v=9。
import { readFileSync, writeFileSync } from 'node:fs'

const [, , jsPath, htmlPath] = process.argv
if (!jsPath || !htmlPath) { console.error('usage: node viewer-selfhide-patch.mjs <index.js> <index.html>'); process.exit(2) }

const OLD = 'if(i){e||(e=new a("1.16.4","player",u.scene).mesh,u.scene.add(e)),'
const NEW = 'if(i){e||(e=new a("1.16.4","player",u.scene).mesh,e.visible=!1,u.scene.add(e)),'

let js = readFileSync(jsPath, 'utf8')
if (js.includes('e.visible=!1')) {
  console.log('index.js: already self-hidden, skip')
} else {
  const n = js.split(OLD).length - 1
  if (n !== 1) { console.error(`ABORT: OLD pattern x${n} (expect 1) — bundle 与补丁预期不符`); process.exit(1) }
  js = js.replace(OLD, NEW)
  writeFileSync(jsPath, js)
  console.log(`index.js: self-hidden (len ${js.length})`)
}

let html = readFileSync(htmlPath, 'utf8')
if (html.includes('index.js?v=9')) {
  console.log('index.html: already v=9, skip')
} else if (html.includes('index.js?v=8')) {
  writeFileSync(htmlPath, html.replace('index.js?v=8', 'index.js?v=9'))
  console.log('index.html: script -> index.js?v=9')
} else {
  console.error('ABORT: index.html script tag 不符预期'); process.exit(1)
}
