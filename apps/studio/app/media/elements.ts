import { newId } from '@lumen/core'
import type { Element, Frame } from '@lumen/schema'
import type { MediaKindName } from './paths'

export type MediaFit = 'cover' | 'contain' | 'stretch'
export type MediaElement = Extract<Element, { kind: 'image' | 'video' }>

/** Minimal media row shape used to build a layer. */
export interface MediaAssetLike {
  id: string
  kind: MediaKindName
  sha256: string
  width: number | null
  height: number | null
}

export interface MediaElementOptions {
  id?: string
  fit?: MediaFit
  frame?: Partial<Frame>
  opacity?: number
  z?: number
}

const SLIDE_ASPECT = 16 / 9
const MEDIA_BOX = 0.8

/** A centered frame that contains the asset inside the 16:9 slide. */
export function mediaFrameFor(asset: MediaAssetLike, aspect = SLIDE_ASPECT): Frame {
  const width = asset.width && asset.width > 0 ? asset.width : 16
  const height = asset.height && asset.height > 0 ? asset.height : 9
  const assetAspect = width / height
  let w = MEDIA_BOX
  let h = MEDIA_BOX
  if (assetAspect > aspect) {
    h = (MEDIA_BOX * aspect) / assetAspect
  } else {
    w = (MEDIA_BOX * assetAspect) / aspect
  }
  w = Math.min(1, Math.max(0.05, w))
  h = Math.min(1, Math.max(0.05, h))
  return {
    x: (1 - w) / 2,
    y: (1 - h) / 2,
    w,
    h,
    rotation: 0,
  }
}

export function isMediaAsset(asset: MediaAssetLike): asset is MediaAssetLike & {
  kind: 'image' | 'video'
} {
  return asset.kind === 'image' || asset.kind === 'video'
}

export function isMediaElement(element: Element | null): element is MediaElement {
  return element?.kind === 'image' || element?.kind === 'video'
}

export function mediaAssetId(element: Element | null): string | null {
  return isMediaElement(element) ? element.source.assetId : null
}

/** Builds an image or video layer. Audio and unknown kinds return null. */
export function createMediaElement(
  asset: MediaAssetLike,
  options: MediaElementOptions = {},
): MediaElement | null {
  if (!isMediaAsset(asset)) return null
  const base = {
    id: options.id ?? newId('element'),
    frame: { ...mediaFrameFor(asset), ...options.frame },
    z: options.z ?? 0,
    opacity: options.opacity ?? 1,
    source: { assetId: asset.id, hash: asset.sha256 },
    fit: options.fit ?? 'cover',
  }
  if (asset.kind === 'image') {
    return { ...base, kind: 'image', radius: 0 }
  }
  return {
    ...base,
    kind: 'video',
    loop: true,
    muted: true,
    volume: 1,
    startMs: 0,
  }
}

/**
 * Replaces the media source of an element while keeping its id, frame, z and
 * opacity. Returns the original element when it is not a media layer.
 */
export function replaceMediaSource(
  element: Element,
  asset: MediaAssetLike,
  fit?: MediaFit,
): Element {
  if (!isMediaElement(element) || !isMediaAsset(asset)) return element
  const nextFit = fit ?? element.fit
  if (asset.kind === 'image') {
    return {
      kind: 'image',
      id: element.id,
      frame: element.frame,
      z: element.z,
      opacity: element.opacity,
      source: { assetId: asset.id, hash: asset.sha256 },
      fit: nextFit,
      radius: element.kind === 'image' ? element.radius : 0,
    }
  }
  return {
    kind: 'video',
    id: element.id,
    frame: element.frame,
    z: element.z,
    opacity: element.opacity,
    source: { assetId: asset.id, hash: asset.sha256 },
    fit: nextFit,
    loop: element.kind === 'video' ? element.loop : true,
    muted: element.kind === 'video' ? element.muted : true,
    volume: element.kind === 'video' ? element.volume : 1,
    startMs: element.kind === 'video' ? element.startMs : 0,
  }
}

export function setMediaFit(element: Element, fit: MediaFit): Element {
  return isMediaElement(element) ? { ...element, fit } : element
}

/** True when a slide (background or layer) uses a video source. */
export function slideHasVideo(slide: {
  background: { kind: string }
  elements: Element[]
} | null): boolean {
  if (!slide) return false
  if (slide.background.kind === 'video') return true
  return slide.elements.some((element) => element.kind === 'video')
}
