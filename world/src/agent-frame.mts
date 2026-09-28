/** One bounded, read-only first-person frame from the existing Prismarine scene. */
import { chromium } from 'playwright-core'

export const FRAME_WIDTH = 640
export const FRAME_HEIGHT = 360
export const FRAME_FOV = 120
const MAX_PNG_BYTES = 1024 * 1024

export class AgentFrameError extends Error {
  constructor(code, status = 503) { super(code); this.code = code; this.status = status }
}

export function kiritoPose(bot, expectedUuid) {
  const player = bot?.players?.Kirito
  const entity = player?.entity
  const position = entity?.position
  if (!player || !entity || !position || typeof player.uuid !== 'string'
      || player.uuid.toLowerCase() !== expectedUuid.toLowerCase()
      || ![position.x, position.y, position.z, entity.yaw, entity.pitch].every(Number.isFinite)) {
    throw new AgentFrameError('kirito_viewpoint_unavailable')
  }
  if (!bot.entity?.position || Math.hypot(position.x - bot.entity.position.x,
      position.z - bot.entity.position.z) > 40) {
    throw new AgentFrameError('kirito_chunks_unloaded')
  }
  const column = bot.world?.getColumn?.(Math.floor(position.x / 16), Math.floor(position.z / 16))
  if (!column || typeof column.then === 'function') throw new AgentFrameError('kirito_chunks_unloaded')
  return { x: position.x, y: position.y, z: position.z, eyeY: entity.eyeY ?? position.y + 1.62,
    yaw: entity.yaw, pitch: entity.pitch, dimension: bot.game?.dimension,
    actorName: 'Kirito', actorUuid: player.uuid.toLowerCase(), sampledAt: entity.sampledAt ?? Date.now(),
    geometrySampledAt: entity.geometrySampledAt ?? entity.sampledAt ?? Date.now(),
    hud: entity.hud ?? null }
}

export class AgentFrameCapture {
  constructor({ port, chromiumPath = process.env.CHROMIUM_PATH ?? '/usr/bin/chromium' }) {
    this.port = port
    this.chromiumPath = chromiumPath
    this.browser = null
    this.busy = false
  }

  async capture(readPose, refreshScene = null) {
    if (this.busy) throw new AgentFrameError('frame_busy', 429)
    this.busy = true
    let page
    let stage = 'launch'
    try {
      if (!this.browser?.isConnected()) {
        this.browser = await chromium.launch({ executablePath: this.chromiumPath, headless: true,
          args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle',
            '--use-angle=swiftshader', '--enable-webgl'] })
      }
      page = await this.browser.newPage({ viewport: { width: FRAME_WIDTH, height: FRAME_HEIGHT }, deviceScaleFactor: 1 })
      stage = 'navigate'
      page.setDefaultTimeout(25000)
      await page.goto(`http://127.0.0.1:${this.port}/?agent_frame=1`, { waitUntil: 'domcontentloaded' })
      stage = 'scene_ready'
      await page.waitForFunction(() => globalThis.__qdViewerRuntime?.sceneReady === true
        && globalThis.world?.renderer?.domElement?.width > 0, { timeout: 25000 })
      stage = 'scene_details'
      const ready = await page.evaluate(() => ({
        chunks: globalThis.__qdViewerDiagnostics?.get?.().chunks ?? null,
        canvasWidth: globalThis.world.renderer.domElement.width,
      }))
      if (ready.chunks === 0 || ready.canvasWidth <= 0) throw new AgentFrameError('frame_terrain_unavailable')
      stage = 'camera'
      const cameraFov = await page.evaluate(() => globalThis.world?.camera?.fov ?? null)
      if (!Number.isFinite(cameraFov) || Math.abs(cameraFov - FRAME_FOV) > 0.1) {
        throw new AgentFrameError('frame_camera_unavailable')
      }
      // The viewer's camera is relative to its own scene origin. Its native
      // first-person position event already applies Numen's pose and FOV.
      // The bundled star point cloud appears as thousands of square white
      // artifacts in software Chromium even against a daylight sky.
      await page.evaluate("globalThis.world.scene.traverse(object => { if (object.isPoints && (object.geometry?.attributes?.position?.count ?? 0) >= 1000) object.visible = false })")
      await page.evaluate("document.querySelectorAll('.boot,.viewer-hud,.manual-viewer-overlay,.camera-follow-status,.skill-cue,.npc-toast').forEach(el => el.remove())")
      stage = 'terrain_ready'
      let png = null
      const deadline = Date.now() + 12000
      do {
        await page.waitForTimeout(450)
        png = await page.screenshot({ type: 'png', animations: 'disabled' })
        if (png.length >= 10000 && png.length <= MAX_PNG_BYTES
            && png.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') break
      } while (Date.now() < deadline)
      if (!png || png.length < 10000 || png.length > MAX_PNG_BYTES
          || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new AgentFrameError('frame_pixels_invalid')
      // Remeshing nine columns would blank the frame. Re-read only the Numen
      // pose once terrain is visibly ready; reject a changed region/dimension.
      if (refreshScene) {
        stage = 'refresh_pose'
        await refreshScene({ poseOnly: true })
      }
      const samplePose = readPose()
      stage = 'screenshot'
      await page.waitForTimeout(350)
      png = await page.screenshot({ type: 'png', animations: 'disabled' })
      if (png.length < 10000 || png.length > MAX_PNG_BYTES
          || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new AgentFrameError('frame_pixels_invalid')
      if (Date.now() - samplePose.sampledAt > 4500) throw new AgentFrameError('frame_stale')
      return { png, pose: samplePose, width: FRAME_WIDTH, height: FRAME_HEIGHT, fovDegrees: FRAME_FOV }
    } catch (error) {
      if (error instanceof AgentFrameError) throw error
      console.error('[agent-frame] capture failed at', stage, error instanceof Error ? error.message : String(error))
      throw new AgentFrameError('frame_renderer_unavailable')
    } finally {
      await page?.close().catch(() => {})
      this.busy = false
    }
  }

  async close() {
    const browser = this.browser
    this.browser = null
    await browser?.close().catch(() => {})
  }
}
