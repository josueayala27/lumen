import { createComposition, createLayer } from '@lumen/core'
import type { Composition } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import { compositionHasVideo } from './videoRefresh'

function withSource(kind: 'video' | 'image', enabled = true): Composition {
  const base = createComposition()
  const source =
    kind === 'video'
      ? { id: 'src', kind: 'video' as const, asset: { assetId: 'a' }, loop: true, inMs: 0, outMs: null, rate: 1, reverse: false, muted: true, volume: 1 }
      : { id: 'src', kind: 'image' as const, asset: { assetId: 'a' } }
  const layer = { ...createLayer({ name: 'L' }), sourceId: 'src', enabled }
  return { ...base, sources: [source as Composition['sources'][number]], layers: [layer] }
}

describe('compositionHasVideo', () => {
  it('is false without a composition or video', () => {
    expect(compositionHasVideo(null)).toBe(false)
    expect(compositionHasVideo(createComposition())).toBe(false)
    expect(compositionHasVideo(withSource('image'))).toBe(false)
  })

  it('is true when an enabled layer shows a video', () => {
    expect(compositionHasVideo(withSource('video'))).toBe(true)
  })

  it('ignores videos on disabled layers', () => {
    expect(compositionHasVideo(withSource('video', false))).toBe(false)
  })
})
