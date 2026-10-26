import { describe, expect, it } from 'vitest'
import { createApp } from '../src'

const env = {
  BETTER_AUTH_SECRET: 'test',
  API_ORIGIN: 'http://localhost:4000',
  WEB_ORIGIN: 'http://localhost:3001',
  REALTIME_TOKEN_SECRET: 'test',
}

describe('api', () => {
  it('answers health without a database', async () => {
    const app = createApp({ logger: false })
    const response = await app.request('/health', {}, env)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })

  it('serves the service identity', async () => {
    const app = createApp({ logger: false })
    const response = await app.request('/', {}, env)
    expect(await response.json()).toEqual({ name: 'lumen-api', status: 'ok' })
  })
})
