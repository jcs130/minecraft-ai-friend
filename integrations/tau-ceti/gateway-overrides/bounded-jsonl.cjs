'use strict'
const fs = require('node:fs')
const { StringDecoder } = require('node:string_decoder')
const { createHash } = require('node:crypto')

// Registry exports can exceed V8's single-string limit. Bound individual rows,
// not the whole file, and never silently skip a truncated or oversized row.
function * lines (file, { chunkBytes = 65536, maxLineBytes = 2097152 } = {}) {
  const descriptor = fs.openSync(file, 'r')
  const buffer = Buffer.alloc(chunkBytes), decoder = new StringDecoder('utf8')
  let pending = ''
  try {
    let count
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) {
      pending += decoder.write(buffer.subarray(0, count))
      let end
      while ((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, end).replace(/\r$/, '')
        if (Buffer.byteLength(line, 'utf8') > maxLineBytes) throw Error('REGISTRY_LINE_BUDGET')
        yield line
        pending = pending.slice(end + 1)
      }
      if (Buffer.byteLength(pending, 'utf8') > maxLineBytes) throw Error('REGISTRY_LINE_BUDGET')
    }
    pending += decoder.end()
    if (Buffer.byteLength(pending, 'utf8') > maxLineBytes) throw Error('REGISTRY_LINE_BUDGET')
    if (pending) yield pending.replace(/\r$/, '')
  } finally { fs.closeSync(descriptor) }
}

function fileHash (file) {
  const descriptor = fs.openSync(file, 'r'), buffer = Buffer.alloc(1048576)
  const hash = createHash('sha256')
  try {
    let count
    while ((count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, count))
    return hash.digest('hex')
  } finally { fs.closeSync(descriptor) }
}
module.exports = { lines, fileHash }
