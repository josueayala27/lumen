import { buildBlankPresentation, buildSongDoc, updatePresentationDoc } from '@lumen/core'
import type { Composition, PlaylistDoc, PresentationDoc, Screen } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TRANSITION, type LiveCompositionTransform, type MediaAssetLike } from '~/live/liveContent'
import { buildLiveItems } from '~/live/liveSession'
import {
  applyTimelineTransform,
  canvasScreen,
  contentLayerId,
  cueAt,
  nextCue,
  outputAction,
  outputTransition,
  programComposition,
  releaseContentLayer,
  screenForMode,
  showComposition,
  showKeyAction,
  statusErrors,
  type OutputMemory,
  type ShowFrame,
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
import { schematicFrame, type SchematicFrame } from './schematic'

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

/** What a screen shows for a frame, through the browser schematic. */
function showScreenFrame(show: ShowDoc, live: ReturnType<typeof emptyLive>, screen: Screen, frame: ShowFrame, ctx: ComposeContext): SchematicFrame {
  return schematicFrame(showComposition(show, live, frame, ctx), screenForMode(screen, frame.mode))
}

function texts(drawn: SchematicFrame): string[] {
  return drawn.layers.flatMap((layer) => (layer.kind === 'text' ? [layer.text] : []))
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
    expect(texts(showScreenFrame(show, live, show.screens[0]!, frame, context))).toContain('Agenda')
  })

  it('lets a grid clip on the content layer win until the rundown takes it back', () => {
    const show = showWithClips()
    const live = launchColumn(show, emptyLive(), 1)
    const frame = { cue: cueAt(items, 0, 0), mode: 'live' as const }
    expect(texts(showScreenFrame(show, live, show.screens[0]!, frame, context))).toContain('Grid line')
    const released = releaseContentLayer(show, live)
    expect(released.active[show.composition.layers[2]!.id]).toBeNull()
    expect(texts(showScreenFrame(show, released, show.screens[0]!, frame, context))).toContain('Welcome')
    expect(releaseContentLayer(show, released)).toBe(released)
  })

  it('shows a title card for items without a document', () => {
    const show = createShowDoc()
    const drawn = showScreenFrame(show, emptyLive(), show.screens[0]!, { cue: cueAt(items, 1, 0), mode: 'live' }, context)
    expect(texts(drawn)).toContain('Walk-in loop')
  })
})

describe('modes', () => {
  const show = showWithClips()
  const live = launchColumn(show, emptyLive(), 0)
  const cue = cueAt(items, 0, 0)

  it('black and logo give a black frame on every screen', () => {
    for (const mode of ['black', 'logo'] as const) {
      const drawn = showScreenFrame(show, live, show.screens[1]!, { cue, mode }, context)
      expect(drawn.layers).toHaveLength(0)
      expect(drawn.background).toBe('#000000')
    }
  })

  it('clear hides only content layers', () => {
    const drawn = showScreenFrame(show, live, show.screens[0]!, { cue, mode: 'clear' }, context)
    expect(texts(drawn)).toHaveLength(0)
    expect(drawn.layers.some((layer) => layer.kind === 'video')).toBe(true)
  })

  it('test patterns win over modes', () => {
    const patterned = updateScreen(show, show.screens[0]!.id, { testPattern: 'bars' })
    const drawn = showScreenFrame(patterned, live, patterned.screens[0]!, { cue, mode: 'black' }, context)
    expect(drawn.layers.some((layer) => layer.id.startsWith('pattern-bar'))).toBe(true)
  })

  it('renders the whole canvas on a virtual screen', () => {
    const screen = canvasScreen(show)
    expect(screen.size).toEqual(show.composition.canvas)
    expect(screen.layout.layers).toEqual({ mode: 'all' })
  })
})

describe('screenForMode', () => {
  const screen = createShowDoc().screens[0]!

  it('blacks out the screen for black and logo only', () => {
    expect(screenForMode(screen, 'black').blackout).toBe(true)
    expect(screenForMode(screen, 'logo').blackout).toBe(true)
    for (const mode of ['live', 'clear', 'freeze'] as const) expect(screenForMode(screen, mode)).toBe(screen)
  })

  it('keeps the test pattern so Rust draws it over the blackout', () => {
    const patterned = { ...screen, testPattern: 'bars' as const }
    expect(screenForMode(patterned, 'black')).toMatchObject({ blackout: true, testPattern: 'bars' })
  })
})

describe('showComposition', () => {
  it('clear removes the content layer source and keeps the others', () => {
    const show = showWithClips()
    const live = launchColumn(show, emptyLive(), 0)
    const cue = cueAt(items, 0, 0)
    const composition = showComposition(show, live, { cue, mode: 'clear' }, context)
    expect(composition.layers[2]!.sourceId).toBeNull()
    expect(composition.layers[0]!.sourceId).not.toBeNull()
  })

  it('carries a font for every text element, the placeholder title card included', () => {
    const show = createShowDoc()
    for (const cue of [cueAt(items, 0, 0), cueAt(items, 1, 0)]) {
      const composition = showComposition(show, emptyLive(), { cue, mode: 'live' }, context)
      const used = composition.sources.flatMap((source) =>
        source.kind === 'slide' ? source.elements.flatMap((element) => (element.kind === 'text' ? [element.fontId] : [])) : [],
      )
      expect(used.length).toBeGreaterThan(0)
      for (const id of used) expect(composition.fonts.map((font) => font.id)).toContain(id)
    }
    // The title card is the same source each time it is built (no fresh element ids).
    const card = (): unknown => showComposition(show, emptyLive(), { cue: cueAt(items, 1, 0), mode: 'live' }, context).sources
    expect(card()).toEqual(card())
  })

  it('black keeps the composition and leaves blackout to the screen', () => {
    const show = showWithClips()
    const cue = cueAt(items, 0, 0)
    const live = showComposition(show, emptyLive(), { cue, mode: 'live' }, context)
    const black = showComposition(show, emptyLive(), { cue, mode: 'black' }, context)
    expect(black.layers.map((layer) => layer.sourceId)).toEqual(live.layers.map((layer) => layer.sourceId))
  })

  it('runs the timeline transform with the cue slide and the content layer', () => {
    const show = createShowDoc()
    const layerId = contentLayerId(show.composition)!
    const cue = cueAt(items, 0, 0)
    let seen: { layerId: string | null; doc: PresentationDoc | null | undefined } | null = null
    const transform: LiveCompositionTransform = {
      key: 'k',
      apply: (input: Composition, source, contentId) => {
        seen = { layerId: contentId, doc: source?.doc }
        return { ...input, master: { ...input.master, opacity: 0.5 } }
      },
    }
    const result = showComposition(show, emptyLive(), { cue, mode: 'live' }, context, transform)
    expect(seen).toEqual({ layerId, doc: talk })
    expect(result.master.opacity).toBe(0.5)
    const plain = programComposition(show, emptyLive(), { cue, mode: 'live' }, context)
    expect(applyTimelineTransform(plain, null, cue, layerId)).toBe(plain)
  })
})

describe('outputAction', () => {
  const previous: OutputMemory = { label: 'out-1', cueKey: 'a:0', mode: 'live', transition: null, transitionEndsAt: 0 }
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

describe('outputTransition', () => {
  const fading: OutputMemory = { label: 'out-1', cueKey: 'a:1', mode: 'live', transition: DEFAULT_TRANSITION, transitionEndsAt: 1300 }
  const next = { cueKey: 'a:1', transition: DEFAULT_TRANSITION }

  it('starts the cue transition on a cue change', () => {
    expect(outputTransition(null, 'transition', next, 0)).toEqual(DEFAULT_TRANSITION)
  })

  it('keeps a running fade alive on same-cue updates, then cuts', () => {
    expect(outputTransition(fading, 'apply', next, 1200)).toEqual(DEFAULT_TRANSITION)
    expect(outputTransition(fading, 'apply', next, 1300)).toBeNull()
    expect(outputTransition(fading, 'apply', { ...next, cueKey: 'a:2' }, 1200)).toBeNull()
    expect(outputTransition(null, 'apply', next, 0)).toBeNull()
  })
})

describe('statusErrors', () => {
  it('names the screens Rust could not drive', () => {
    const screens = createShowDoc().screens
    const statuses = [
      { screenId: screens[0]!.id, label: 'audience-1', error: null },
      { screenId: screens[1]!.id, label: null, error: 'display Projector is not connected' },
      { screenId: 'gone', label: null, error: 'screen has no display target' },
    ]
    expect(statusErrors(statuses, screens)).toEqual([
      `${screens[1]!.name}: display Projector is not connected`,
      'gone: screen has no display target',
    ])
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
