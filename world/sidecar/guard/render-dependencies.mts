import { createRequire } from 'node:module'
import { join } from 'node:path'

// Use explicitly selected installed dependencies read-only, or this checkout's
// normal node_modules. This does not redirect the renderer source or its data.
export const renderRequire = process.env.NUMEN_NODE_MODULES
  ? createRequire(join(process.env.NUMEN_NODE_MODULES, '.qiandeng-render.cjs'))
  : createRequire(import.meta.url)
