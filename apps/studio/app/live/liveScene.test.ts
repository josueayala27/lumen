import { buildBlankPresentation, compositionToScene, createComposition, createScreen, defaultTheme } from '@lumen/core'
import type { PresentationDoc } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import {
  assetsForDoc,
  blackScene,
  collectAssetIds,
  effectiveTransition,
  sceneForSlide,
  sceneVideoKey,
  withTimelineMedia,
  type MediaAssetLike,
} from './liveScene'

function doc(): PresentationDoc {
  return buildBlankPresentation('Live test')
}

function slideOf(value: PresentationDoc) {
  return value.slides[0]!
}

const media: MediaAssetLike[] = [
  {
    id: 'media_image',
    kind: 'image',
    sha256: 'hash-image',
    width: 1920,
    height: 1080,
    localPath: '/media/image.png',
    missing: false,
  },
  {
    id: 'media_video',
    kind: 'video',
    sha256: 'hash-video',
    width: 1280,
    height: 720,
    localPath: '/media/video.mp4',
    missing: true,
  },
  {
    id: 'media_audio',
    kind: 'audio',
    sha256: 'hash-audio',
    width: null,
    height: null,
    localPath: '/media/audio.mp3',
    missing: false,
  },
]

describe('scene building', () => {
  it('builds an audience scene at the document size', () => {
    const scene = sceneForSlide({ doc: doc(), slideIndex: 0, label: 'Slide 1' }, null, [], 7)
    expect(scene.revision).toBe(7)
    expect(scene.role).toBe('audience')
    expect(scene.viewport).toEqual({ width: 1920, height: 1080, scale: 1 })
    expect(scene.layers.some((layer) => layer.kind === 'text')).toBe(true)
  })

  it('uses the theme background for transparent slides', () => {
    const source: PresentationDoc = {
      ...doc(),
      slides: [{ ...slideOf(doc()), background: { kind: 'transparent' } }],
    }
    const scene = sceneForSlide(
      { doc: source, slideIndex: 0, label: 'Slide 1' },
      defaultTheme(),
      [],
      1,
    )
    expect(scene.background).toMatchObject({ kind: 'shape', fill: '#101828' })
  })

  it('falls back to a title card for items without a document', () => {
    const scene = sceneForSlide({ doc: null, slideIndex: 0, label: 'Media' }, null, [], 5)
    const text = scene.layers.find((layer) => layer.kind === 'text')
    expect(text?.kind).toBe('text')
    if (text?.kind === 'text') {
      expect(text.runs.map((run) => run.text).join('')).toBe('Media')
    }
  })

  it('resolves referenced media into scene assets and skips audio', () => {
    const imageDoc: PresentationDoc = {
      ...doc(),
      slides: [
        {
          ...slideOf(doc()),
          background: {
            kind: 'image',
            source: { assetId: 'media_image', hash: 'hash-image' },
            fit: 'cover',
            dim: 0,
          },
        },
      ],
    }
    expect(collectAssetIds(imageDoc)).toEqual(['media_image'])
    expect(assetsForDoc(imageDoc, media)).toEqual([
      {
        id: 'media_image',
        hash: 'hash-image',
        kind: 'image',
        localPath: '/media/image.png',
        url: null,
        intrinsic: { width: 1920, height: 1080 },
        state: 'ready',
      },
    ])
    expect(assetsForDoc(imageDoc, media)).toHaveLength(1)
  })

  it('marks a missing video asset', () => {
    const videoDoc: PresentationDoc = {
      ...doc(),
      slides: [
        {
          ...slideOf(doc()),
          background: {
            kind: 'video',
            source: { assetId: 'media_video', hash: 'hash-video' },
            fit: 'cover',
            loop: true,
            muted: true,
            volume: 0.4,
          },
        },
      ],
    }
    expect(assetsForDoc(videoDoc, media)).toEqual([
      {
        id: 'media_video',
        hash: 'hash-video',
        kind: 'video',
        localPath: '/media/video.mp4',
        url: null,
        intrinsic: { width: 1280, height: 720 },
        state: 'missing',
      },
    ])
  })
})

describe('black scene', () => {
  it('is an opaque black frame with no layers', () => {
    const black = blackScene(2)
    expect(black.layers).toEqual([])
    expect(black.background).toMatchObject({ kind: 'shape', fill: '#000000' })
  })
})

describe('transition plans', () => {
  it('uses the slide, theme or default transition in order', () => {
    const theme = defaultTheme()
    expect(effectiveTransition(null, null)).toEqual({
      kind: 'fade',
      durationMs: 300,
      easing: 'cubic-bezier(0.2, 0, 0, 1)',
    })
    expect(effectiveTransition(null, theme)).toEqual(theme.transition)
    const slide = {
      ...slideOf(doc()),
      transition: { kind: 'zoom' as const, durationMs: 450, easing: 'linear' },
    }
    expect(effectiveTransition(slide, theme)).toEqual({
      kind: 'zoom',
      durationMs: 450,
      easing: 'linear',
    })
  })
})

describe('timeline media', () => {
  const video: MediaAssetLike = { id: 'v1', kind: 'video', sha256: 'hv', width: 1920, height: 1080, localPath: '/m/v.mp4', missing: false }
  const audio: MediaAssetLike = { id: 'a1', kind: 'audio', sha256: 'ha', width: null, height: null, localPath: '/m/a.mp3', missing: false }

  it('adds video and image clips as the bottom composition layers', () => {
    const base = createComposition({ width: 1920, height: 1080 })
    const composition = withTimelineMedia(base, [
      { clipId: 'c1', asset: video, startMs: 1500, loop: false, gain: 0 },
      { clipId: 'c2', asset: audio, startMs: 0, loop: false, gain: 1 },
    ])
    expect(composition.layers).toHaveLength(1)
    expect(composition.layers[0]).toMatchObject({ id: 'timeline-media-c1', sourceId: 'timeline-media-c1', fit: 'cover' })
    expect(composition.sources[0]).toMatchObject({ kind: 'video', inMs: 1500, muted: true, loop: false })
    expect(composition.assets.map((asset) => asset.id)).toContain('v1')
  })

  it('returns the same composition when no visual clip is active', () => {
    const base = createComposition()
    expect(withTimelineMedia(base, [])).toBe(base)
    expect(withTimelineMedia(base, [{ clipId: 'c2', asset: audio, startMs: 0, loop: false, gain: 1 }])).toBe(base)
  })
})

describe('scene video key', () => {
  it('lists video assets with their start so preloads change only when videos do', () => {
    const base = sceneForSlide({ doc: doc(), slideIndex: 0, label: 'Slide' }, null, [], 1)
    expect(sceneVideoKey(base)).toBe('')
    const video: MediaAssetLike = { id: 'v1', kind: 'video', sha256: 'hv', width: 1920, height: 1080, localPath: '/m/v.mp4', missing: false }
    const composition = withTimelineMedia(createComposition(), [{ clipId: 'c1', asset: video, startMs: 500, loop: true, gain: 0 }])
    const withVideo = compositionToScene(composition, createScreen())
    expect(sceneVideoKey(withVideo)).toBe('v1@500')
    expect(sceneVideoKey({ ...withVideo, revision: 99 })).toBe('v1@500')
  })
})
