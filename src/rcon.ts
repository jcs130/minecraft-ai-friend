import net from 'node:net'

/**
 * Minimal Minecraft (Source) RCON client — no external deps.
 *
 * Packet layout (little-endian):
 *   [4] length  = 10 + payload.length  (requestId 4 + type 4 + payload + 2 null)
 *   [4] requestId
 *   [4] type    — 3 = AUTH (login), 2 = EXECCOMMAND (and AUTH_RESPONSE), 0 = RESPONSE_VALUE
 *   [n] payload (utf-8)
 *   [2] padding (two null bytes)
 */
function encodePacket(id: number, type: number, payload: string): Buffer {
  const payloadBuf = Buffer.from(payload, 'utf-8')
  const len = 10 + payloadBuf.length
  const buf = Buffer.alloc(4 + len)
  buf.writeInt32LE(len, 0)
  buf.writeInt32LE(id, 4)
  buf.writeInt32LE(type, 8)
  payloadBuf.copy(buf, 12)
  return buf
}

interface Waiter {
  kind: 'auth' | 'cmd'
  chunks: string[]
  resolve: (v: string) => void
  reject: (e: Error) => void
}

export class Rcon {
  private socket: net.Socket | null = null
  private nextId = 1
  private pending = new Map<number, Waiter>()
  private buffer = Buffer.alloc(0)

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly password: string,
  ) {}

  isConnected(): boolean {
    return this.socket !== null && !this.socket.destroyed
  }

  connect(timeoutMs = 6000): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port })
      this.socket = socket
      socket.on('data', (chunk) => this.onData(chunk as Buffer))
      socket.once('error', (err) => reject(err))
      socket.setTimeout(timeoutMs, () => reject(new Error('rcon connect timeout')))
      socket.once('connect', () => {
        socket.setTimeout(0)
        const id = this.nextId++
        this.pending.set(id, {
          kind: 'auth',
          chunks: [],
          resolve: () => resolve(),
          reject,
        })
        socket.write(encodePacket(id, 3, this.password))
      })
    })
  }

  send(command: string, timeoutMs = 8000): Promise<string> {
    if (!this.socket) return Promise.reject(new Error('rcon not connected'))
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error('rcon command timed out'))
      }, timeoutMs)
      this.pending.set(id, {
        kind: 'cmd',
        chunks: [],
        resolve: (v) => {
          clearTimeout(timer)
          resolve(v)
        },
        reject: (e) => {
          clearTimeout(timer)
          reject(e)
        },
      })
      this.socket!.write(encodePacket(id, 2, command))
    })
  }

  private onData(chunk: Buffer) {
    this.buffer = Buffer.concat([this.buffer, chunk])
    while (this.buffer.length >= 4) {
      const len = this.buffer.readInt32LE(0)
      if (this.buffer.length < 4 + len) break
      const packet = this.buffer.slice(4, 4 + len)
      this.buffer = this.buffer.slice(4 + len)

      const id = packet.readInt32LE(0)
      const type = packet.readInt32LE(4)
      const payload = packet.slice(8, packet.length - 2).toString('utf-8')

      if (id === -1) {
        // AUTH failure: reject every pending auth waiter.
        for (const [pid, w] of this.pending) {
          if (w.kind === 'auth') {
            this.pending.delete(pid)
            w.reject(new Error('rcon auth failed (wrong password?)'))
          }
        }
        continue
      }

      const waiter = this.pending.get(id)
      if (!waiter) continue

      if (waiter.kind === 'auth' && type === 2) {
        this.pending.delete(id)
        waiter.resolve('')
      } else if (waiter.kind === 'cmd' && type === 0) {
        // Vanilla RCON replies with exactly one RESPONSE_VALUE packet per
        // command (payload may be empty, e.g. for `say`); no terminator.
        this.pending.delete(id)
        waiter.resolve(payload)
      }
    }
  }

  close() {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    for (const [, w] of this.pending) {
      w.reject(new Error('rcon closed'))
    }
    this.pending.clear()
  }
}
