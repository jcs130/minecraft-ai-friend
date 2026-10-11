'use strict'
const fs = require('node:fs')
const http = require('node:http'), https = require('node:https'), net = require('node:net')
const { randomUUID } = require('node:crypto')
class TransportError extends Error {
  constructor (code, unconfirmed = false) { super(code); this.code = code; this.unconfirmed = unconfirmed }
}
function endpoint (value) {
  let u
  try { u = new URL(value) } catch { throw new TransportError('numen_endpoint_invalid') }
  const h = u.hostname.replace(/^\[|\]$/g, '')
  const privateV4 = net.isIP(h) === 4 && (h.startsWith('127.') || h.startsWith('10.') || h.startsWith('192.168.') ||
    (h.startsWith('172.') && Number(h.split('.')[1]) >= 16 && Number(h.split('.')[1]) <= 31))
  const privateV6 = net.isIP(h) === 6 && (h === '::1' || /^(fc|fd)/i.test(h))
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || !u.pathname.endsWith('/mcp')) throw new TransportError('numen_endpoint_invalid')
  if (u.protocol === 'http:' && h !== 'localhost' && !privateV4 && !privateV6) throw new TransportError('numen_public_endpoint_requires_https')
  return u
}
function createNumenClient ({ url, token, timeoutMs = 15000 }) {
  const target = endpoint(url)
  if (!/^[a-f0-9]{64}$/.test(token || '') || !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120000) throw new TransportError('numen_private_credentials_invalid')
  async function rpc (method, params = {}) {
    const id = randomUUID(), data = Buffer.from(JSON.stringify({ jsonrpc: '2.0', id, method, params }), 'utf8')
    if (data.length > 65536) throw new TransportError('numen_request_over_budget')
    return new Promise((resolve, reject) => {
      let timer
      const request = (target.protocol === 'https:' ? https : http).request(target, {
        method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json',
          Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-06-18', 'Content-Length': data.length }
      }, response => {
        if (response.statusCode >= 300 && response.statusCode < 400) {
          response.resume(); request.destroy(); reject(new TransportError('numen_redirect_refused', true)); return
        }
        if (response.statusCode !== 200) {
          response.resume(); reject(new TransportError('numen_http_' + response.statusCode, response.statusCode >= 500)); return
        }
        let length = 0; const buffers = []
        response.on('data', chunk => {
          length += chunk.length
          if (length > 1048576) request.destroy(new TransportError('numen_response_over_budget', true))
          else buffers.push(chunk)
        })
        response.on('aborted', () => reject(new TransportError('numen_response_aborted', true)))
        response.on('error', () => reject(new TransportError('numen_response_unconfirmed', true)))
        response.on('end', () => {
          let value
          try { value = JSON.parse(Buffer.concat(buffers).toString('utf8')) } catch { reject(new TransportError('numen_response_invalid', true)); return }
          if (value?.jsonrpc !== '2.0' || value.id !== id || !value.result || value.error) {
            reject(new TransportError('numen_rpc_receipt_invalid', true)); return
          }
          resolve(value.result)
        })
      })
      timer = setTimeout(() => request.destroy(new TransportError('numen_request_unconfirmed_query_original_action_id', true)), timeoutMs)
      request.on('close', () => clearTimeout(timer))
      request.on('error', error => reject(error instanceof TransportError ? error : new TransportError('numen_request_unconfirmed_query_original_action_id', true)))
      request.end(data)
    })
  }
  return { rpc, async call (name, args = {}) {
    const result = await rpc('tools/call', { name, arguments: args })
    if (!result?.structuredContent || typeof result.structuredContent !== 'object') throw new TransportError('numen_structured_receipt_missing', true)
    return result.structuredContent
  } }
}
function credentials (file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
    return { url: value.endpoint, token: value.token, ownerUuid: value.ownerUuid }
  } catch { throw new TransportError('numen_private_credentials_unreadable') }
}
module.exports = { createNumenClient, credentials, endpoint, TransportError }
