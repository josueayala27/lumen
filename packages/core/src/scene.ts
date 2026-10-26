import type {
  Background,
  Element,
  Paint,
  PresentationDoc,
  Scene,
  SceneAsset,
  SceneFont,
  SceneLayer,
  Slide,
  Theme,
} from '@lumen/schema'

export interface SceneViewport {
  width: number
  height: number
  scale?: number
}

export interface SceneContext {
  assets: SceneAsset[]
  fonts: SceneFont[]
  revision: number
  role?: Scene['role']
}

export function paintToCss(paint: Paint): string {
  switch (paint.kind) {
    case 'solid':
      return paint.color
    case 'linear': {
      const stops = paint.stops.map((stop) => `${stop.color} ${Math.round(stop.at * 100)}%`).join(', ')
      return `linear-gradient(${paint.angle}deg, ${stops})`
    }
    case 'none':
      return 'transparent'
  }
}

function backgroundLayer(background: Background): SceneLayer | null {
  switch (background.kind) {
    case 'transparent':
      return null
    case 'solid':
      return {
        kind: 'shape',
        id: 'slide-background',
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        z: -1000,
        opacity: 1,
        fill: background.color,
        stroke: null,
        strokeWidth: 0,
        radius: 0,
      }
    case 'gradient':
      return {
        kind: 'shape',
        id: 'slide-background',
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        z: -1000,
        opacity: 1,
        fill: paintToCss(background.paint),
        stroke: null,
        strokeWidth: 0,
        radius: 0,
      }
    case 'image':
      return {
        kind: 'image',
        id: 'slide-background',
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        z: -1000,
        opacity: 1 - background.dim,
        source: background.source,
        fit: background.fit,
        radius: 0,
      }
    case 'video':
      return {
        kind: 'video',
        id: 'slide-background',
        frame: { x: 0, y: 0, w: 1, h: 1, rotation: 0 },
        z: -1000,
        opacity: 1,
        source: background.source,
        fit: background.fit,
        loop: background.loop,
        muted: background.muted,
        volume: background.volume,
        startMs: 0,
      }
  }
}

function elementLayer(element: Element): SceneLayer {
  switch (element.kind) {
    case 'text':
      return {
        kind: 'text',
        id: element.id,
        frame: element.frame,
        z: element.z,
        opacity: element.opacity,
        runs: element.runs,
        fontId: element.style.fontId,
        fontSize: element.style.fontSize,
        weight: element.style.weight,
        color: element.style.color,
        align: element.style.align,
        vAlign: element.layout.vAlign,
        lineHeight: element.style.lineHeight,
        letterSpacing: element.style.letterSpacing,
        fit: element.layout.fit,
        padding: element.layout.padding,
        maxLines: element.layout.maxLines,
        shadow: element.effects.shadow,
        outline: element.effects.outline,
      }
    case 'shape':
      return {
        kind: 'shape',
        id: element.id,
        frame: element.frame,
        z: element.z,
        opacity: element.opacity,
        fill: paintToCss(element.fill),
        stroke: element.stroke ? paintToCss(element.stroke) : null,
        strokeWidth: element.strokeWidth,
        radius: element.radius,
      }
    case 'image':
      return {
        kind: 'image',
        id: element.id,
        frame: element.frame,
        z: element.z,
        opacity: element.opacity,
        source: element.source,
        fit: element.fit,
        radius: element.radius,
      }
    case 'video':
      return {
        kind: 'video',
        id: element.id,
        frame: element.frame,
        z: element.z,
        opacity: element.opacity,
        source: element.source,
        fit: element.fit,
        loop: element.loop,
        muted: element.muted,
        volume: element.volume,
        startMs: element.startMs,
      }
  }
}

export function slideBackground(slide: Slide, theme: Theme | null): Background {
  return slide.background.kind === 'transparent' && theme ? theme.background : slide.background
}

export function buildScene(
  doc: PresentationDoc,
  theme: Theme | null,
  slideIndex: number,
  viewport: SceneViewport,
  context: SceneContext,
): Scene {
  const slide = doc.slides[slideIndex]
  if (!slide) throw new Error(`Slide ${slideIndex} does not exist`)

  const background = backgroundLayer(slideBackground(slide, theme))
  const layers = slide.elements
    .slice()
    .sort((a, b) => a.z - b.z)
    .map(elementLayer)

  const safe = doc.settings.safeArea
  return {
    schemaVersion: 1,
    revision: context.revision,
    role: context.role ?? 'preview',
    viewport: {
      width: viewport.width,
      height: viewport.height,
      scale: viewport.scale ?? 1,
    },
    colorSpace: 'srgb',
    background,
    layers,
    fonts: context.fonts,
    assets: context.assets,
    safeArea: { top: safe, right: safe, bottom: safe, left: safe },
  }
}
