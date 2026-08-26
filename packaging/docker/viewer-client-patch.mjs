// prismarine-viewer web 客户端 follow=smart 跟镜头补丁（在镜像内对容器自己的 bundle 施展）
// 用法: node patch.mjs <index.js 路径> <index.html 路径>
// 背景: stock 第三人称只在首个 position 事件摆一次相机(s=!1 后永不跟), 之后只 tween
//       小人模型 → 面板「化身过去了、画面不过去」。面板 iframe URL 一直带着
//       ?follow=smart, 本补丁让它生效: 相机随位移增量平移(保留环绕/缩放), target 钉化身。
// 无参数时保持 stock 行为; index.html 引 index.js?v=8 防旧 bundle 缓存。
import { readFileSync, writeFileSync } from 'node:fs'

const [, , jsPath, htmlPath] = process.argv
if (!jsPath || !htmlPath) { console.error('usage: node patch.mjs <index.js> <index.html>'); process.exit(2) }

const OLD = 'o.on("position",(({pos:t,addMesh:i,yaw:r,pitch:o})=>{if(void 0!==r&&void 0!==o)return h&&(h.dispose(),h=null),void u.setFirstPersonCamera(t,r,o);if(t.y>0&&s&&(h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20),h.update(),s=!1),i){e||(e=new a("1.16.4","player",u.scene).mesh,u.scene.add(e)),new n.Tween(e.position).to({x:t.x,y:t.y,z:t.z},50).start();const i=(r-e.rotation.y)%(2*Math.PI),o=2*i%(2*Math.PI)-i;new n.Tween(e.rotation).to({y:e.rotation.y+o},50).start()}}))'

const NEW = ('o.on("position",(function(d){var t=d.pos,i=d.addMesh,r=d.yaw,p=d.pitch;'
  + 'if(void 0!==r&&void 0!==p){h&&(h.dispose(),h=null);u.setFirstPersonCamera(t,r,p);return}'
  + 'var q=null;try{q=new URLSearchParams(window.location.search).get("follow")}catch(e){}'
  + 'var fl="smart"===q||"1"===q||"true"===q;'
  + 'if(t.y>0&&h){'
  + 'if(s){h.target.set(t.x,t.y,t.z),u.camera.position.set(t.x,t.y+20,t.z+20)}'
  + 'else if(fl){var lt=window.__pvLast;'
  + 'if(lt){u.camera.position.x+=t.x-lt.x;u.camera.position.y+=t.y-lt.y;u.camera.position.z+=t.z-lt.z}'
  + 'else{u.camera.position.set(t.x,t.y+20,t.z+20)}'
  + 'h.target.set(t.x,t.y,t.z)}'
  + 'h.update();s=!1;window.__pvLast={x:t.x,y:t.y,z:t.z}}'
  + 'if(i){e||(e=new a("1.16.4","player",u.scene).mesh,u.scene.add(e)),'
  + 'new n.Tween(e.position).to({x:t.x,y:t.y,z:t.z},50).start();'
  + 'var d2=(r-e.rotation.y)%(2*Math.PI),o2=2*d2%(2*Math.PI)-d2;'
  + 'new n.Tween(e.rotation).to({y:e.rotation.y+o2},50).start()}}))')

let js = readFileSync(jsPath, 'utf8')
if (js.includes('__pvLast')) {
  console.log('index.js: already patched, skip')
} else {
  const n = js.split(OLD).length - 1
  if (n !== 1) { console.error(`ABORT: OLD pattern x${n} (expect 1) — bundle 与补丁预期不符`); process.exit(1) }
  js = js.replace(OLD, NEW)
  writeFileSync(jsPath, js)
  console.log(`index.js: patched (len ${js.length})`)
}

let html = readFileSync(htmlPath, 'utf8')
const OLDH = '<script type="text/javascript" src="index.js"></script>'
const NEWH = '<script type="text/javascript" src="index.js?v=8"></script>'
if (html.includes('index.js?v=8')) {
  console.log('index.html: already v=8, skip')
} else if (html.includes(OLDH)) {
  writeFileSync(htmlPath, html.replace(OLDH, NEWH))
  console.log('index.html: script -> index.js?v=8')
} else {
  console.error('ABORT: index.html script tag 不符预期'); process.exit(1)
}
