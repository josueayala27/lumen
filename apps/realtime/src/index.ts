import { verifyToken } from '@lumen/auth-token'
import { liveMessageSchema, type LiveMessage, type LiveState } from '@lumen/schema'
import { DurableObject } from 'cloudflare:workers'

export interface Env {
  ROOMS: DurableObjectNamespace
  REALTIME_TOKEN_SECRET: string
  ALLOWED_ORIGINS: string
}

interface Attachment {
  userId: string
  role: 'operator' | 'viewer'
  seq: number
}

interface Snapshot {
  seq: number
  state: LiveState
}

const MAX_MESSAGE_BYTES = 512 * 1024
const MAX_CONNECTIONS = 32

function tokenFrom(request: Request): string | null {
  const header = request.headers.get('Authorization')
  if (header?.startsWith('Bearer ')) return header.slice('Bearer '.length)
  const protocols = request.headers.get('Sec-WebSocket-Protocol') ?? ''
  for (const value of protocols.split(',').map((item) => item.trim())) {
    if (value.startsWith('lumen.token.')) return value.slice('lumen.token.'.length)
  }
  return null
}

export class LiveRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('Expected WebSocket upgrade', { status: 426 })
    }
    const token = tokenFrom(request)
    if (!token) return new Response('Unauthorized', { status: 401 })
    const payload = await verifyToken(token, this.env.REALTIME_TOKEN_SECRET)
    if (!payload || payload.scope !== 'live') return new Response('Unauthorized', { status: 401 })
    if (this.ctx.getWebSockets().length >= MAX_CONNECTIONS) return new Response('Too many connections', { status: 503 })

    const [client, server] = Object.values(new WebSocketPair())
    if (!client || !server) return new Response('WebSocket unavailable', { status: 500 })
    const attachment: Attachment = {
      userId: payload.sub,
      role: payload.role === 'viewer' ? 'viewer' : 'operator',
      seq: 0,
    }
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment(attachment)

    const snapshot = await this.snapshot()
    if (snapshot) this.send(server, { type: 'snapshot', seq: snapshot.seq, state: snapshot.state })

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw)
    if (text.length > MAX_MESSAGE_BYTES) {
      ws.close(1009, 'Message too large')
      return
    }
    const parsed = (() => {
      try {
        return liveMessageSchema.safeParse(JSON.parse(text))
      } catch {
        return liveMessageSchema.safeParse(null)
      }
    })()
    if (!parsed.success) {
      ws.close(1002, 'Invalid message')
      return
    }
    const message = parsed.data
    const attachment = ws.deserializeAttachment() as Attachment | null
    if (!attachment) {
      ws.close(1002, 'Missing attachment')
      return
    }

    if (message.type === 'hello') {
      const snapshot = await this.snapshot()
      if (snapshot) this.send(ws, { type: 'snapshot', seq: snapshot.seq, state: snapshot.state })
      return
    }

    if (message.type === 'snapshot') {
      if (attachment.role !== 'operator') {
        ws.close(1008, 'Read-only connection')
        return
      }
      await this.ctx.storage.put('snapshot', { seq: message.seq, state: message.state } satisfies Snapshot)
      this.broadcast(message, ws)
      return
    }

    if (message.type === 'command') {
      // Remote controllers send commands; the desktop authority applies them and returns a snapshot.
      this.broadcast(message, ws)
      return
    }

    if (message.type === 'ack') {
      this.broadcast(message, ws)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close()
  }

  private async snapshot(): Promise<Snapshot | null> {
    return (await this.ctx.storage.get<Snapshot>('snapshot')) ?? null
  }

  private send(ws: WebSocket, message: LiveMessage): void {
    try {
      ws.send(JSON.stringify(message))
    } catch (error) {
      console.error('realtime send failed', error)
    }
  }

  private broadcast(message: LiveMessage, except?: WebSocket): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === except) continue
      this.send(socket, message)
    }
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const match = /^\/session\/([A-Z0-9]{6})$/.exec(url.pathname)
    if (!match) return new Response('Not found', { status: 404 })
    const code = match[1]!
    const origin = request.headers.get('Origin')
    const allowed = env.ALLOWED_ORIGINS.split(',').map((value) => value.trim()).filter(Boolean)
    if (origin && allowed.length && !allowed.includes(origin)) return new Response('Forbidden', { status: 403 })
    const stub = env.ROOMS.get(env.ROOMS.idFromName(code))
    return stub.fetch(request)
  },
} satisfies ExportedHandler<Env>
