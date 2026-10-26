import { describe, expect, it } from 'vitest'
import { signToken, verifyToken } from '../src'

describe('auth tokens', () => {
  it('round-trips a valid token', async () => {
    const token = await signToken({ sub: 'user_1', scope: 'realtime', workspaceId: 'w1' }, 'secret', 60)
    const payload = await verifyToken(token, 'secret')
    expect(payload).toMatchObject({ sub: 'user_1', scope: 'realtime', workspaceId: 'w1' })
  })

  it('rejects a token signed with another secret', async () => {
    const token = await signToken({ sub: 'user_1', scope: 'realtime' }, 'secret', 60)
    expect(await verifyToken(token, 'other')).toBeNull()
  })

  it('rejects an expired token', async () => {
    const token = await signToken({ sub: 'user_1', scope: 'realtime', exp: 1 }, 'secret', 60)
    expect(await verifyToken(token, 'secret')).toBeNull()
  })
})
