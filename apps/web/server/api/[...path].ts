import { defineHandler, HTTPError, proxyRequest } from 'nitro/h3'
import { useRuntimeConfig } from 'nitro/runtime-config'

// Same-origin gateway: `/api/**` → api Worker without the `/api` prefix.
export default defineHandler((event) => {
  const apiOrigin = String(useRuntimeConfig().apiOrigin ?? '')
  if (!apiOrigin) throw new HTTPError({ status: 500, message: 'API origin is not configured' })
  const path = event.url.pathname.replace(/^\/api/, '') || '/'
  const target = new URL(path + event.url.search, apiOrigin)
  return proxyRequest(event, target.toString(), { xfwd: true })
})
