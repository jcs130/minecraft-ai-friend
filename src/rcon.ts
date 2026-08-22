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
  // 连接真实状态：服务端断开/错误时由 close/error 处理器置 false，
  // 供 isConnected() 准确判断，避免往死 socket 写命令等 8s 超时。
  private connected = false

  constructor(
    private readonly host: string,
    private readonly port: number,
    private readonly password: string,
  ) {}

  isConnected(): boolean {
    return this.connected && this.socket !== null && !this.socket.destroyed
  }

  connect(timeoutMs = 6000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (ok: boolean, err?: Error) => {
        if (settled) return
        settled = true
        if (ok) resolve()
        else reject(err)
      }
      const socket = net.createConnection({ host: this.host, port: this.port })
      this.socket = socket
      // TCP keepalive：死亡连接能较快被系统察觉（默认 10s 后开始探测），
      // 触发 close/error → 及时拒绝 pending，而不是石沉大海等 8s 超时。
      socket.setKeepAlive(true, 10_000)
      socket.on('data', (chunk) => this.onData(chunk as Buffer))
      socket.on('close', () => {
        this.onClosed()
        finish(false, new Error('rcon closed'))
      })
      socket.on('error', (err) => {
        this.onError(err)
        finish(false, err)
      })
      socket.setTimeout(timeoutMs, () => {
        socket.destroy()
        finish(false, new Error('rcon connect timeout'))
      })
      socket.once('connect', () => {
        socket.setTimeout(0)
        const id = this.nextId++
        this.pending.set(id, {
          kind: 'auth',
          chunks: [],
          resolve: () => {
            this.connected = true
            finish(true)
          },
          reject: (e) => {
            this.connected = false
            finish(false, e)
          },
        })
        socket.write(encodePacket(id, 3, this.password))
      })
    })
  }

  private onClosed() {
    this.connected = false
    // 连接已断：立即拒绝所有在途命令，避免 caller 等满 timeout。
    for (const [, w] of this.pending) {
      w.reject(new Error('rcon closed'))
    }
    this.pending.clear()
  }

  private onError(err: Error) {
    // 已连接的 socket 出错：标记断开并拒绝 pending；不抛未捕获异常。
    this.connected = false
    for (const [, w] of this.pending) {
      w.reject(err || new Error('rcon error'))
    }
    this.pending.clear()
    this.socket?.destroy()
    this.socket = null
  }

  send(command: string, timeoutMs = 8000): Promise<string> {
    if (!this.socket || !this.connected) return Promise.reject(new Error('rcon not connected'))
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
    this.connected = false
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
