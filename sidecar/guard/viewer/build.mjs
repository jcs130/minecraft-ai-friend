// 守卫之眼浏览器入口打包（等效 prismarine-viewer webpack 配置的浏览器化处理）
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

await build({
  entryPoints: [path.join(__dirname, 'main.ts')],
  bundle: true,
  outfile: path.join(__dirname, '..', 'viewer-dist', 'main.js'),
  format: 'iife',
  platform: 'browser',
  target: 'chrome120',
  define: {
    __dirname: '"/"',
    __filename: '""',
    'process.platform': '"browser"',
    'process.env.NODE_ENV': '"production"',
  },
  plugins: [{
    name: 'pv-browser-compat',
    setup (b) {
      const pvLib = path.join('node_modules', 'prismarine-viewer', 'viewer', 'lib')
      // viewer/lib/utils.js（双模式含 node 依赖）→ utils.web.js（浏览器版）
      b.onResolve({ filter: /viewer[\\/]lib[\\/]utils\.js$/ }, () => ({
        path: path.resolve(__dirname, pvLib, 'utils.web.js'),
      }))
      // node 内建模块：浏览器端用 stub
      b.onResolve({ filter: /^(path|zlib)$/ }, () => ({
        path: path.join(__dirname, 'stub.js'),
      }))
      b.onResolve({ filter: /^node-canvas-webgl\/lib$/ }, () => ({
        path: path.join(__dirname, 'stub.js'),
      }))
    },
  }],
}).then(() => console.log('bundle OK: sidecar/guard/viewer-dist/main.js'))
