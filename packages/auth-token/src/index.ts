export interface TokenPayload {
  sub: string
  scope: string
  workspaceId?: string
  sessionId?: string
  exp?: number
  [key: string]: unknown
}

const encoder = new TextEncoder()

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/')
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='))
  return Uint8Array.from(binary, (char) => char.charCodeAt(0))
}

async function key(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

export async function signToken(payload: TokenPayload, secret: string, ttlSeconds = 300): Promise<string> {
  const body: TokenPayload = { ...payload, exp: payload.exp ?? Math.floor(Date.now() / 1000) + ttlSeconds }
  const encoded = base64url(encoder.encode(JSON.stringify(body)))
  const signature = await crypto.subtle.sign('HMAC', await key(secret), encoder.encode(encoded))
  return `${encoded}.${base64url(new Uint8Array(signature))}`
}

export async function verifyToken(token: string, secret: string): Promise<TokenPayload | null> {
  const [encoded, signature] = token.split('.')
  if (!encoded || !signature) return null
  const signatureBytes = fromBase64url(signature)
  const valid = await crypto.subtle.verify(
    'HMAC',
    await key(secret),
    signatureBytes.buffer as ArrayBuffer,
    encoder.encode(encoded),
  )
  if (!valid) return null
  let payload: TokenPayload
  try {
    payload = JSON.parse(new TextDecoder().decode(fromBase64url(encoded))) as TokenPayload
  } catch {
    return null
  }
  if (typeof payload.exp === 'number' && payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}
