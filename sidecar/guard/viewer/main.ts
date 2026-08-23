/**
 * 守卫之眼 · 浏览器渲染入口（2026-08-24）
 *
 * 由 esbuild 打包为 viewer-dist/main.js。页面通过 URL 参数控制渲染方式：
 *   ?fov=105      第一人称广角视野（默认 90）
 *   ?mode=fp      第一人称（默认，跟随守卫朝向）
 *   ?mode=top     正俯视：相机在守卫上方 h 格，垂直向下
 *   ?mode=top3    高空斜视（类第三视角）：守卫东南上方 d/h 格，看向守卫
 *   ?h=40&d=30    俯视高度 / 斜视水平偏移
 * 暴露 window.viewer 供 playwright 截图前微调（改 fov/相机后调用 requestRender()）。
 */
import * as THREE from 'three'
import { io } from 'socket.io-client'
import { Viewer } from 'prismarine-viewer/viewer'

// prismarine-viewer 部分代码（entities.js 等）依赖全局 THREE（webpack ProvidePlugin 等价物）
;(globalThis as any).THREE = THREE

const params = new URLSearchParams(location.search)
const fov = Number(params.get('fov') ?? '90')
const mode = params.get('mode') ?? 'fp'
const h = Number(params.get('h') ?? '40')
const d = Number(params.get('d') ?? '30')

const canvas = document.createElement('canvas')
canvas.style.cssText = 'width:100%;height:100%;display:block'
document.body.appendChild(canvas)

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))

const viewer = new Viewer(renderer)
viewer.camera.fov = fov
viewer.camera.updateProjectionMatrix()
;(window as any).viewer = viewer

const socket = io({ path: '/socket.io' })

socket.on('version', (v: string) => {
  if (!viewer.setVersion(v)) { console.error('unsupported version:', v); return }
  viewer.listen(socket)
})

socket.on('position', (pkt: any) => {
  const { pos, yaw, pitch } = pkt
  if (!pos) return
  if (mode === 'top') {
    viewer.camera.position.set(pos.x, pos.y + h, pos.z)
    viewer.camera.lookAt(pos.x, pos.y, pos.z)
  } else if (mode === 'top3') {
    viewer.camera.position.set(pos.x + d, pos.y + h, pos.z + d)
    viewer.camera.lookAt(pos.x, pos.y + 1, pos.z)
  } else {
    // fp：跟随守卫朝向（yaw/pitch 由服务端发；缺省则用默认视角）
    if (yaw !== undefined && pitch !== undefined) {
      viewer.setFirstPersonCamera(pos, yaw, pitch)
    } else {
      viewer.camera.position.set(pos.x, pos.y + 1.6, pos.z)
      viewer.camera.lookAt(pos.x + 10, pos.y + 1.6, pos.z)
    }
  }
})

function animate () {
  requestAnimationFrame(animate)
  renderer.render(viewer.scene, viewer.camera)
}
animate()

// 供 playwright 调整后强制再渲一帧
;(window as any).requestRender = () => renderer.render(viewer.scene, viewer.camera)
