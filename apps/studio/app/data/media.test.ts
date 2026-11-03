import { describe, expect, it } from 'vitest'
import { hasThumbnail } from './media'

describe('hasThumbnail', () => {
  it('covers images and video posters, not audio or missing files', () => {
    expect(hasThumbnail({ kind: 'image', missing: false })).toBe(true)
    expect(hasThumbnail({ kind: 'video', missing: false })).toBe(true)
    expect(hasThumbnail({ kind: 'audio', missing: false })).toBe(false)
    expect(hasThumbnail({ kind: 'video', missing: true })).toBe(false)
  })
})
