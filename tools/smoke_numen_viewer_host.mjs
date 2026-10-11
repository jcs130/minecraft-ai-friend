// Finite QA child owned/stopped by smoke_numen_viewer.py. No game login or model.
import http from 'node:http'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import readline from 'node:readline'
import { attachNumenViewerGateway } from '../world/src/society-agent/numen-viewer-gateway.mjs'
const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const { prepareNativeWorldPreviewHost, createNativePlayerPresentation } = await import(pathToFileURL(config.viewerHostModule))
const nbt = createRequire(import.meta.url)('prismarine-nbt')
const prepared = await prepareNativeWorldPreviewHost({ assetDirectory: config.assetDirectory, port: config.port })
const server = http.createServer((_req, res) => { res.writeHead(404); res.end() })
const gateway = attachNumenViewerGateway({ server, prepared, assetDirectory: config.assetDirectory, registryDirectory: config.registryDirectory,
  createPresentation: createNativePlayerPresentation, simplifyNBT: tag => tag?.type ? nbt.simplify(tag) : tag, upstreamPort: config.upstreamPort })
server.listen(config.port, '127.0.0.1', () => fs.writeFileSync(config.readyFile, JSON.stringify({ ready: true, port: config.port })))
let closing = false
async function stop () { if (closing) return; closing = true; gateway.close(); await new Promise(resolve => server.close(resolve)); process.exit(0) }
readline.createInterface({ input: process.stdin }).on('line', line => { if (line === 'stop') void stop() })
process.on('SIGTERM', stop); process.on('SIGINT', stop)
