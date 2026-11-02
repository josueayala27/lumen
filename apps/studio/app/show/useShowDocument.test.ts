import { addShowLayer, createShowDoc, updateCompositionLayer } from '@lumen/core'
import type { ShowDoc } from '@lumen/schema'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createShowDocument } from './useShowDocument'

function setup(initial: ShowDoc = createShowDoc()) {
  const saved: ShowDoc[] = []
  const doc = createShowDocument(
    {
      load: async () => initial,
      save: async (show) => {
        saved.push(show)
      },
    },
    100,
  )
  return { doc, saved, initial }
}

describe('createShowDocument', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('loads once and exposes composition and screens', async () => {
    const { doc, initial } = setup()
    await Promise.all([doc.load(), doc.load()])
    expect(doc.loaded.value).toBe(true)
    expect(doc.show.value).toBe(initial)
    expect(doc.composition.value.layers).toHaveLength(3)
    expect(doc.screens.value).toHaveLength(3)
  })

  it('bumps the revision on every change and saves after a debounce', async () => {
    const { doc, saved } = setup()
    await doc.load()
    const before = doc.composition.value.revision
    doc.update((show) => addShowLayer(show, { name: 'One' }))
    doc.update((show) => addShowLayer(show, { name: 'Two' }))
    expect(doc.composition.value.revision).toBe(before + 2)
    expect(saved).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(150)
    expect(saved).toHaveLength(1)
    expect(saved[0]!.composition.layers).toHaveLength(5)
  })

  it('ignores edits that return the same show', async () => {
    const { doc } = setup()
    await doc.load()
    const before = doc.show.value
    doc.update((show) => show)
    expect(doc.show.value).toBe(before)
    expect(doc.canUndo.value).toBe(false)
  })

  it('undoes and redoes with a revision that keeps increasing', async () => {
    const { doc } = setup()
    await doc.load()
    doc.update((show) => addShowLayer(show, { name: 'Extra' }))
    const edited = doc.composition.value.revision
    expect(doc.canUndo.value).toBe(true)
    doc.undo()
    expect(doc.composition.value.layers).toHaveLength(3)
    expect(doc.composition.value.revision).toBeGreaterThan(edited)
    expect(doc.canRedo.value).toBe(true)
    doc.redo()
    expect(doc.composition.value.layers).toHaveLength(4)
  })

  it('coalesces edits with the same key into one undo step', async () => {
    const { doc } = setup()
    await doc.load()
    const id = doc.composition.value.layers[0]!.id
    for (const opacity of [0.9, 0.8, 0.7]) {
      doc.updateComposition((composition) => updateCompositionLayer(composition, id, { opacity }), { coalesce: 'opacity' })
    }
    expect(doc.composition.value.layers[0]!.opacity).toBe(0.7)
    doc.undo()
    expect(doc.composition.value.layers[0]!.opacity).toBe(1)
    expect(doc.canUndo.value).toBe(false)
  })

  it('applies edits without history when asked', async () => {
    const { doc } = setup()
    await doc.load()
    doc.updateScreens((screens) => screens.slice(0, 1), { history: false })
    expect(doc.screens.value).toHaveLength(1)
    expect(doc.canUndo.value).toBe(false)
  })
})
