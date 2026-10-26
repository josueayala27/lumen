import { describe, expect, it } from 'vitest'
import {
  createMediaElement,
  isMediaElement,
  mediaAssetId,
  mediaFrameFor,
  replaceMediaSource,
  setMediaFit,
  slideHasVideo,
  type MediaAssetLike,
} from './elements'

function asset(kind: MediaAssetLike['kind'], width: number | null, height: number | null): MediaAssetLike {
  return { id: `media_${kind}`, kind, sha256: `hash_${kind}`, width, height }
}

describe('mediaFrameFor', () => {
  it('matches the slide aspect at the media box size', () => {
    const frame = mediaFrameFor(asset('image', 1920, 1080))
    expect(frame.x).toBeCloseTo(0.1, 6)
    expect(frame.y).toBeCloseTo(0.1, 6)
    expect(frame.w).toBeCloseTo(0.8, 6)
    expect(frame.h).toBeCloseTo(0.8, 6)
    expect(frame.rotation).toBe(0)
  })

  it('letterboxes portrait media inside the slide', () => {
    const frame = mediaFrameFor(asset('image', 1080, 1920))
    expect(frame.w).toBeLessThan(0.3)
    expect(frame.h).toBeCloseTo(0.8, 5)
    expect(frame.x).toBeCloseTo((1 - frame.w) / 2, 5)
    expect(frame.y).toBeCloseTo((1 - frame.h) / 2, 5)
  })
})

describe('createMediaElement', () => {
  it('builds an image layer with the asset reference', () => {
    const element = createMediaElement(asset('image', 800, 600), { fit: 'contain' })
    expect(element?.kind).toBe('image')
    expect(element?.source).toEqual({ assetId: 'media_image', hash: 'hash_image' })
    expect(element?.fit).toBe('contain')
  })

  it('builds a video layer with muted looping defaults', () => {
    const element = createMediaElement(asset('video', 1280, 720))
    expect(element?.kind).toBe('video')
    if (element?.kind !== 'video') throw new Error('expected video')
    expect(element.loop).toBe(true)
    expect(element.muted).toBe(true)
    expect(element.startMs).toBe(0)
  })

  it('ignores audio and unknown assets', () => {
    expect(createMediaElement(asset('audio', 0, 0))).toBeNull()
  })
})

describe('replaceMediaSource', () => {
  it('keeps id, frame and z while changing kind and source', () => {
    const image = createMediaElement(asset('image', 800, 600), { id: 'layer_1' })
    if (!image) throw new Error('expected image')
    const frame = { ...image.frame, x: 0.2, y: 0.3 }
    const next = replaceMediaSource(
      { ...image, frame, z: 4 },
      asset('video', 1920, 1080),
      'cover',
    )
    expect(next.id).toBe('layer_1')
    expect(next.frame).toEqual(frame)
    expect(next.z).toBe(4)
    expect(next.kind).toBe('video')
    if (next.kind !== 'video') throw new Error('expected video')
    expect(next.source.assetId).toBe('media_video')
  })

  it('does not touch text layers', () => {
    const text = {
      kind: 'text' as const,
      id: 'text_1',
      frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
      z: 0,
      opacity: 1,
      runs: [],
      style: {
        fontId: 'inter',
        fontSize: 40,
        weight: 400,
        italic: false,
        color: '#fff',
        align: 'center' as const,
        lineHeight: 1.2,
        letterSpacing: 0,
      },
      layout: {
        align: 'center' as const,
        vAlign: 'middle' as const,
        lineHeight: 1.2,
        letterSpacing: 0,
        fit: 'wrap' as const,
        padding: 0,
        maxLines: null,
      },
      effects: { shadow: null, outline: null },
    }
    expect(replaceMediaSource(text, asset('image', 10, 10))).toBe(text)
  })
})

describe('media layer helpers', () => {
  it('recognises media layers and their asset ids', () => {
    const element = createMediaElement(asset('video', 640, 360))
    expect(isMediaElement(element)).toBe(true)
    expect(mediaAssetId(element)).toBe('media_video')
    expect(mediaAssetId(null)).toBeNull()
  })

  it('sets fit only on media layers', () => {
    const element = createMediaElement(asset('image', 640, 360))
    if (!element) throw new Error('expected image')
    const next = setMediaFit(element, 'stretch')
    expect(next.kind).toBe('image')
    if (next.kind !== 'image') throw new Error('expected image')
    expect(next.fit).toBe('stretch')
  })
})

describe('slideHasVideo', () => {
  it('detects video backgrounds and layers', () => {
    expect(slideHasVideo(null)).toBe(false)
    expect(slideHasVideo({ background: { kind: 'video' }, elements: [] })).toBe(true)
    expect(
      slideHasVideo({
        background: { kind: 'solid' },
        elements: [createMediaElement(asset('video', 10, 10))].filter(
          (element): element is NonNullable<typeof element> => element !== null,
        ),
      }),
    ).toBe(true)
    expect(
      slideHasVideo({
        background: { kind: 'solid' },
        elements: [createMediaElement(asset('image', 10, 10))].filter(
          (element): element is NonNullable<typeof element> => element !== null,
        ),
      }),
    ).toBe(false)
  })
})
