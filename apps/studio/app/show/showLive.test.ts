import { buildBlankPresentation, buildSongDoc, updatePresentationDoc } from '@lumen/core'
import type { PlaylistDoc, PresentationDoc, Scene } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRANSITION, type LiveSceneTransform, type MediaAssetLike } from '~/live/liveScene'
import { buildLiveItems } from '~/live/liveSession'
import {
  applyTimelineTransform,
  canvasScreen,
  contentLayerId,
  cueAt,
  nextCue,
  outputAction,
  programComposition,
  releaseContentLayer,
  showKeyAction,
  showScreenScene,
  type OutputMemory,
} from './showLive'
import {
  assignClip,
  createShowDoc,
  emptyLive,
  launchColumn,
  updateScreen,
  withComposition,
  type ComposeContext,
  type ShowDoc,
} from './showModel'

const media: MediaAssetLike[] = [
  { id: 'media_video', kind: 'video', sha256: 'hash-video', width: 1920, height: 1080, localPath: '/v.mov', missing: false },
]

function doc(title: string, lines: string[]): PresentationDoc {
  return updatePresentationDoc(buildBlankPresentation(title), { title, slideTexts: lines })
}

const talk = doc('Talk', ['Welcome', 'Agenda'])
const song: PresentationDoc = buildSongDoc({ title: 'Song', author: '', ccli: '', key: '', tempo: null, lyrics: 'Grid line' })
const playlist: PlaylistDoc = {
  schemaVersion: 1,
  name: 'Set',
  items: [
    { kind: 'presentation', id: 'item_talk', presentationId: 'p_talk', label: '' },
    { kind: 'media', id: 'item_media', assetId: 'media_video', label: 'Walk-in loop' },
  ],
}
const items = buildLiveItems(playlist, (id) => (id === 'p_talk' ? talk : null))

const context: ComposeContext = {
  media,
  presentation: (id) => (id === 'p_song' ? song : id === 'p_talk' ? talk : null),
  theme: null,
  revision: 3,
}

function texts(scene: Scene): string[] {
  return scene.layers.flatMap((layer) => (layer.kind === 'text' ? [layer.runs.map((run) => run.text).join('')] : []))
}

function showWithClips(): ShowDoc {
  let show = createShowDoc()
  const [background, , lyrics] = show.composition.layers
  show = assignClip(show, background!.id, 0, { kind: 'media', assetId: 'media_video', loop: true }, 'Loop')
  show = assignClip(show, lyrics!.id, 1, { kind: 'presentation', presentationId: 'p_song' }, 'Song')
  return show
}

describe('rundown cues', () => {
  it('resolves positions and rolls into the next item', () => {
    const cue = cueAt(items, 0, 1)
    expect(cue).toMatchObject({ key: 'item_talk:1', presentationId: 'p_talk', slideIndex: 1, label: 'Slide 2' })
    expect(cueAt(items, 5, 0)).toBeNull()
    expect(nextCue(items, 0, 1)?.itemId).toBe('item_media')
    expect(nextCue(items, 1, 0)).toBeNull()
  })

  it('finds the topmost content or lyrics layer', () => {
    const show = createShowDoc()
    expect(contentLayerId(show.composition)).toBe(show.composition.layers[2]!.id)
    const tagged = withComposition(show, (composition) => ({
      ...composition,
      layers: composition.layers.map((layer, index) => (index === 0 ? { ...layer, tags: ['content'] } : { ...layer, tags: [] })),
    }))
    expect(contentLayerId(tagged.composition)).toBe(show.composition.layers[0]!.id)
    expect(contentLayerId({ layers: [] })).toBeNull()
  })
})

describe('programComposition', () => {
  it('puts the cue on the content layer as a slide source while other layers keep playing', () => {
    const show = showWithClips()
    const live = launchColumn(show, emptyLive(), 0)
    const frame = { cue: cueAt(items, 0, 1), mode: 'live' as const }
    const composition = programComposition(show, live, frame, context)
    const lyrics = composition.layers[2]!
    const source = composition.sources.find((entry) => entry.id === lyrics.sourceId)
    expect(source?.kind).toBe('slide')
    expect(composition.layers[0]!.sourceId).toBe(`clip-${show.grid.clips[0]!.id}`)
    expect(texts(showScreenScene(show, live, show.screens[0]!, frame, context))).toContain('Agenda')
  })

  it('lets a grid clip on the content layer win until the rundown takes it back', () => {
    const show = showWithClips()
    const live = launchColumn(show, emptyLive(), 1)
    const frame = { cue: cueAt(items, 0, 0), mode: 'live' as const }
    expect(texts(showScreenScene(show, live, show.screens[0]!, frame, context))).toContain('Grid line')
    const released = releaseContentLayer(show, live)
    expect(released.active[show.composition.layers[2]!.id]).toBeNull()
    expect(texts(showScreenScene(show, released, show.screens[0]!, frame, context))).toContain('Welcome')
    expect(releaseContentLayer(show, released)).toBe(released)
  })

  it('shows a title card for items without a document', () => {
    const show = createShowDoc()
    const scene = showScreenScene(show, emptyLive(), show.screens[0]!, { cue: cueAt(items, 1, 0), mode: 'live' }, context)
    expect(texts(scene)).toContain('Walk-in loop')
  })
})

describe('modes', () => {
  const show = showWithClips()
  const live = launchColumn(show, emptyLive(), 0)
  const cue = cueAt(items, 0, 0)

  it('black and logo give a black frame on every screen', () => {
    for (const mode of ['black', 'logo'] as const) {
      const scene = showScreenScene(show, live, show.screens[1]!, { cue, mode }, context)
      expect(scene.layers).toHaveLength(0)
      expect(scene.background?.kind === 'shape' && scene.background.fill).toBe('#000000')
    }
  })

  it('clear hides only content layers', () => {
    const scene = showScreenScene(show, live, show.screens[0]!, { cue, mode: 'clear' }, context)
    expect(texts(scene)).toHaveLength(0)
    expect(scene.layers.some((layer) => layer.kind === 'video')).toBe(true)
  })

  it('test patterns win over modes', () => {
    const patterned = updateScreen(show, show.screens[0]!.id, { testPattern: 'bars' })
    const scene = showScreenScene(patterned, live, patterned.screens[0]!, { cue, mode: 'black' }, context)
    expect(scene.layers.some((layer) => layer.id.startsWith('pattern-bar'))).toBe(true)
  })

  it('renders the whole canvas on a virtual screen', () => {
    const screen = canvasScreen(show)
    expect(screen.size).toEqual(show.composition.canvas)
    expect(screen.layout.layers).toEqual({ mode: 'all' })
  })
})

describe('applyTimelineTransform', () => {
  it('hands keyframes bare element ids and restores the layer prefix', () => {
    const show = createShowDoc()
    const layerId = contentLayerId(show.composition)!
    const cue = cueAt(items, 0, 0)
    const scene = showScreenScene(show, emptyLive(), show.screens[0]!, { cue, mode: 'live' }, context)
    const elementId = talk.slides[0]!.elements[0]!.id
    expect(scene.layers.some((layer) => layer.id === `${layerId}.${elementId}`)).toBe(true)
    let seen: string[] = []
    const transform: LiveSceneTransform = {
      key: 'k',
      apply: (input, source) => {
        seen = input.layers.map((layer) => layer.id)
        expect(source?.doc).toBe(talk)
        return { ...input, layers: input.layers.map((layer) => (layer.id === elementId ? { ...layer, opacity: 0.25 } : layer)) }
      },
    }
    const result = applyTimelineTransform(scene, transform, cue, layerId)
    expect(seen).toContain(elementId)
    const moved = result.layers.find((layer) => layer.id === `${layerId}.${elementId}`)
    expect(moved?.opacity).toBe(0.25)
    expect(applyTimelineTransform(scene, null, cue, layerId)).toBe(scene)
  })
})

describe('outputAction', () => {
  const scene = showScreenScene(createShowDoc(), emptyLive(), createShowDoc().screens[0]!, { cue: null, mode: 'live' }, context)
  const previous: OutputMemory = { label: 'out-1', scene, cueKey: 'a:0', mode: 'live' }
  const base = { label: 'out-1', mode: 'live' as const, cueKey: 'a:1', transition: DEFAULT_TRANSITION, testPattern: false }

  it('crossfades a new cue on the same output', () => {
    expect(outputAction(previous, base)).toBe('transition')
    expect(outputAction(previous, { ...base, transition: { ...DEFAULT_TRANSITION, kind: 'cut' } })).toBe('apply')
    expect(outputAction(previous, { ...base, cueKey: 'a:0' })).toBe('apply')
    expect(outputAction(null, base)).toBe('apply')
    expect(outputAction({ ...previous, mode: 'black' }, base)).toBe('apply')
  })

  it('holds frozen outputs and seeds new ones', () => {
    expect(outputAction(previous, { ...base, mode: 'freeze' })).toBe('skip')
    expect(outputAction(previous, { ...base, mode: 'freeze', label: 'out-2' })).toBe('apply')
    expect(outputAction(null, { ...base, mode: 'freeze' })).toBe('apply')
  })
})

describe('showKeyAction', () => {
  it('keeps the live keys and adds column launches', () => {
    expect(showKeyAction(' ', 8)).toEqual({ kind: 'next' })
    expect(showKeyAction('ArrowRight', 8)).toEqual({ kind: 'next' })
    expect(showKeyAction('ArrowLeft', 8)).toEqual({ kind: 'prev' })
    expect(showKeyAction('Enter', 8)).toEqual({ kind: 'take' })
    expect(showKeyAction(']', 8)).toEqual({ kind: 'nextItem' })
    expect(showKeyAction('[', 8)).toEqual({ kind: 'prevItem' })
    expect(showKeyAction('b', 8)).toEqual({ kind: 'mode', mode: 'black' })
    expect(showKeyAction('C', 8)).toEqual({ kind: 'mode', mode: 'clear' })
    expect(showKeyAction('l', 8)).toEqual({ kind: 'mode', mode: 'logo' })
    expect(showKeyAction('f', 8)).toEqual({ kind: 'toggleFreeze' })
    expect(showKeyAction('Escape', 8)).toEqual({ kind: 'clearClips' })
    expect(showKeyAction('3', 8)).toEqual({ kind: 'launchColumn', column: 2 })
    expect(showKeyAction('9', 8)).toBeNull()
    expect(showKeyAction('0', 8)).toBeNull()
    expect(showKeyAction('x', 8)).toBeNull()
  })
})
