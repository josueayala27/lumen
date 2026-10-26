import { beforeEach, describe, expect, it } from 'vitest'
import { buildBlankPresentation, updatePresentationDoc } from '@lumen/core'
import type { PlaylistDoc, PresentationDoc } from '@lumen/schema'
import {
  applyLiveCommand,
  buildLiveItems,
  clampLiveState,
  liveContext,
  newLiveState,
  nextLiveSlide,
  presentationLiveItem,
  toLiveSlides,
} from './liveSession'
import {
  LIVE_SESSION_LOCAL_KEY,
  loadLiveSession,
  normalizeLiveSession,
  saveLiveSession,
} from './liveSessionStore'

function doc(title: string, lines: string[]): PresentationDoc {
  return updatePresentationDoc(buildBlankPresentation(title), { title, slideTexts: lines })
}

const first = doc('First', ['One', 'Two'])
const second = doc('Second', ['Three', 'Four'])
const playlist: PlaylistDoc = {
  schemaVersion: 1,
  name: 'Service',
  items: [
    { kind: 'presentation', id: 'item_1', presentationId: 'p1', label: '' },
    { kind: 'presentation', id: 'item_2', presentationId: 'p2', label: 'Message' },
  ],
}

function items() {
  return buildLiveItems(playlist, (id) => (id === 'p1' ? first : id === 'p2' ? second : null))
}

beforeEach(() => {
  localStorage.clear()
})

describe('playlist resolution', () => {
  it('turns presentation slides into live cues', () => {
    const cues = toLiveSlides(second)
    expect(cues.map((cue) => cue.label)).toEqual(['Slide 1', 'Slide 2'])
    expect(cues[0]?.lines).toEqual(['Three'])
  })

  it('resolves labels and missing presentations', () => {
    const resolved = items()
    expect(resolved[0]?.label).toBe('First')
    expect(resolved[1]?.label).toBe('Message')
    expect(resolved[1]?.slides).toHaveLength(2)

    const missing = buildLiveItems(playlist, () => null)
    expect(missing[0]?.slides[0]?.lines).toEqual(['Missing presentation'])
  })

  it('wraps a single presentation as a one-item playlist', () => {
    const item = presentationLiveItem(first, 'item_presentation')
    expect(item.id).toBe('item_presentation')
    expect(liveContext([item]).slideCounts).toEqual([2])
  })
})

describe('live session transitions', () => {
  it('rolls slides and items with next and prev', () => {
    const context = liveContext(items())
    let state = newLiveState('playlist_1')

    state = applyLiveCommand(state, { type: 'next' }, context)
    expect([state.itemIndex, state.slideIndex]).toEqual([0, 1])

    state = applyLiveCommand(state, { type: 'next' }, context)
    expect([state.itemIndex, state.slideIndex]).toEqual([1, 0])

    state = applyLiveCommand(state, { type: 'prev' }, context)
    expect([state.itemIndex, state.slideIndex]).toEqual([0, 1])

    state = applyLiveCommand(state, { type: 'nextItem' }, context)
    expect([state.itemIndex, state.slideIndex]).toEqual([1, 0])

    state = applyLiveCommand(state, { type: 'prevItem' }, context)
    expect([state.itemIndex, state.slideIndex]).toEqual([0, 0])
  })

  it('previews independently and takes the preview live', () => {
    const context = liveContext(items())
    let state = newLiveState('playlist_1')
    state = applyLiveCommand(
      state,
      { type: 'previewGoTo', itemIndex: 1, slideIndex: 1 },
      context,
    )
    expect([state.itemIndex, state.slideIndex]).toEqual([0, 0])

    state = applyLiveCommand(state, { type: 'setMode', mode: 'black' }, context)
    state = applyLiveCommand(state, { type: 'take' }, context)
    expect([state.itemIndex, state.slideIndex, state.mode]).toEqual([1, 1, 'live'])
  })

  it('clamps a restored session to the loaded playlist', () => {
    const context = liveContext(items())
    const stored = {
      ...newLiveState('playlist_1'),
      itemIndex: 99,
      slideIndex: 99,
      previewItemIndex: 99,
      previewSlideIndex: 99,
    }
    const state = clampLiveState(stored, context)
    expect([state.itemIndex, state.slideIndex]).toEqual([1, 1])
    expect([state.previewItemIndex, state.previewSlideIndex]).toEqual([1, 1])
  })

  it('finds the next slide across an item boundary', () => {
    expect(nextLiveSlide(items(), 0, 0)?.lines).toEqual(['Two'])
    expect(nextLiveSlide(items(), 0, 1)?.lines).toEqual(['Three'])
    expect(nextLiveSlide(items(), 1, 1)).toBeNull()
  })
})

describe('live session persistence', () => {
  it('saves and reloads a valid snapshot', async () => {
    const state = newLiveState('playlist_1')
    await saveLiveSession({ playlistId: 'playlist_1', presentationId: null, state })
    const loaded = await loadLiveSession()
    expect(loaded?.playlistId).toBe('playlist_1')
    expect(loaded?.state.sessionId).toBe(state.sessionId)
  })

  it('rejects corrupt snapshots without throwing', async () => {
    localStorage.setItem(
      LIVE_SESSION_LOCAL_KEY,
      JSON.stringify({ playlistId: 'p', presentationId: null, state: { schemaVersion: 2 } }),
    )
    expect(await loadLiveSession()).toBeNull()
    expect(normalizeLiveSession(null)).toBeNull()
  })
})
