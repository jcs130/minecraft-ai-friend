// The existing authorized SSE bytes, carried on one reliable ordered channel.
// No Minecraft packet translation, game command, or lossy terrain delta here.
export const NATIVE_RTC_PROTOCOL = 'mcvisual.sse.v1'
export const NATIVE_RTC_LABEL = 'mcvisual.events.v1'
export const NATIVE_RTC_CHUNK_BYTES = 16 * 1024
export const NATIVE_RTC_EVENT_BYTES = 16 * 1024 * 1024
export const NATIVE_RTC_SDP_BYTES = 64 * 1024

export function validNativeRtcDescription(value, type) {
  return value?.type === type && typeof value.sdp === 'string'
    && new TextEncoder().encode(value.sdp).length <= NATIVE_RTC_SDP_BYTES
    && /^v=0\r?\n/.test(value.sdp)
    && (value.sdp.match(/^m=/gm) ?? []).length === 1
    && /^m=application /m.test(value.sdp)
    && !/^m=(audio|video) /m.test(value.sdp)
}

/** Incremental, bounded decoding; a multibyte name can cross chunk boundaries. */
export function createNativeRtcDecoder(onMessage) {
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
  const encoder = new TextEncoder()
  let partial = '', bufferedBytes = 0, closed = false
  return {
    receive(value) {
      if (closed) return
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value)
        : ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : null
      if (!bytes?.byteLength || bytes.byteLength > NATIVE_RTC_CHUNK_BYTES) throw Error('NATIVE_RTC_CHUNK_INVALID')
      bufferedBytes += bytes.byteLength
      partial += decoder.decode(bytes, { stream: true })
      let boundary
      while ((boundary = /\r?\n\r?\n/.exec(partial))) {
        const end = boundary.index + boundary[0].length
        const block = partial.slice(0, boundary.index), consumed = partial.slice(0, end)
        if (encoder.encode(consumed).length > NATIVE_RTC_EVENT_BYTES) throw Error('NATIVE_RTC_EVENT_LIMIT')
        bufferedBytes -= encoder.encode(consumed).length
        partial = partial.slice(end)
        const data = block.split(/\r?\n/).filter(line => line.startsWith('data:'))
          .map(line => line.slice(5).replace(/^ /, '')).join('\n')
        if (data) onMessage({ data })
        if (closed) return
      }
      if (bufferedBytes > NATIVE_RTC_EVENT_BYTES) throw Error('NATIVE_RTC_EVENT_LIMIT')
    },
    close() { closed = true; partial = ''; bufferedBytes = 0 },
    get bufferedBytes() { return bufferedBytes }
  }
}
