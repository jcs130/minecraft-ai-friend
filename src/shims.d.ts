/**
 * Ambient declarations for modules that resolve through the dsh monorepo's
 * Yarn PnP at runtime but are invisible to plain `tsc`. This file MUST stay
 * a global script (no top-level import/export) for these to count as new
 * ambient modules rather than augmentations.
 *
 * DO NOT put cordis augmentation in this file — a global-script
 * `declare module` for a module that DOES resolve would shadow it.
 * Use cordis-augment.d.ts for that.
 */
declare module '@deepseek-ai/dsh-tools' {
  import type { Context } from '@deepseek-ai/cordis'
  const ToolRuntime: (ctx: Context, config?: unknown) => void
  export default ToolRuntime
  /** Wrap a tool definition; the runtime fills in plumbing. */
  export function defineTool<T extends { name: string }>(tool: T): T
}

declare module '@deepseek-ai/dsh-system-prompt' {
  import type { Context } from '@deepseek-ai/cordis'
  const SystemPrompt: (ctx: Context, config?: unknown) => void
  export default SystemPrompt
}

declare module 'node-canvas-webgl/lib/index.js' {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function createCanvas(width: number, height: number): any
}
