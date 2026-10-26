import { describe, expect, it } from 'vitest'
import { elementSchema, type PresentationDoc } from '@lumen/schema'
import {
  addLayer,
  canRedo,
  canUndo,
  clampSelection,
  clearSelection,
  copySelectedLayers,
  createEditorState,
  createShapeLayer,
  createTextLayer,
  currentSlide,
  duplicateSelectedLayers,
  orderedElements,
  pasteLayers,
  redo,
  removeSelectedLayers,
  reorderLayer,
  selectAllLayers,
  selectLayer,
  selectLayers,
  selectedElements,
  setSlide,
  undo,
  updateDocument,
  updateLayer,
} from '../src/editor'
import { buildBlankPresentation, textSlide } from '../src/presentation'

function twoSlideDoc(): PresentationDoc {
  const base = buildBlankPresentation('Test')
  return {
    ...base,
    slides: [
      { ...base.slides[0]!, id: 'slide_a' },
      { ...textSlide('Second', 'Slide 2', 'slide_b') },
    ],
  }
}

function documentSnapshot(doc: PresentationDoc): string {
  return JSON.stringify(doc)
}

describe('editor state', () => {
  it('starts on the first slide with no selection or history', () => {
    const state = createEditorState(buildBlankPresentation())
    expect(state.slideId).toBe(state.doc.slides[0]?.id)
    expect(state.selection).toEqual([])
    expect(state.clipboard).toEqual([])
    expect(canUndo(state)).toBe(false)
    expect(canRedo(state)).toBe(false)
  })

  it('falls back to the first slide for an unknown slide id', () => {
    const doc = twoSlideDoc()
    const state = createEditorState(doc, 'missing')
    expect(state.slideId).toBe('slide_a')
  })
})

describe('layer factories', () => {
  it('builds valid text and shape elements', () => {
    const text = createTextLayer({ text: 'Hello', frame: { x: 0.2 }, style: { color: '#ff0000' } })
    const shape = createShapeLayer({ frame: { w: 0.3 }, radius: 8 })

    expect(elementSchema.safeParse(text).success).toBe(true)
    expect(elementSchema.safeParse(shape).success).toBe(true)
    expect(text.frame.x).toBe(0.2)
    expect(text.frame.y).toBe(0.3)
    expect(text.style.color).toBe('#ff0000')
    expect(shape.frame.w).toBe(0.3)
    expect(shape.radius).toBe(8)
    expect(text.id).not.toBe(shape.id)
  })
})

describe('layer mutations', () => {
  it('adds a layer on top and selects it without mutating the input document', () => {
    const state = createEditorState(buildBlankPresentation())
    const before = documentSnapshot(state.doc)
    const layer = createTextLayer({ text: 'Added' })

    const next = addLayer(state, layer)
    const slide = currentSlide(next)!

    expect(documentSnapshot(state.doc)).toBe(before)
    expect(next.doc).not.toBe(state.doc)
    expect(slide.elements).toHaveLength(2)
    expect(slide.elements[1]?.id).toBe(layer.id)
    expect(slide.elements[1]?.z).toBe(2)
    expect(next.selection).toEqual([layer.id])
    expect(canUndo(next)).toBe(true)
  })

  it('updates a layer immutably and records history', () => {
    const state = createEditorState(buildBlankPresentation())
    const id = currentSlide(state)!.elements[0]!.id
    const before = documentSnapshot(state.doc)

    const next = updateLayer(state, id, (element) =>
      element.kind === 'text'
        ? { ...element, runs: [{ ...element.runs[0]!, text: 'Changed' }] }
        : element,
    )

    expect(documentSnapshot(state.doc)).toBe(before)
    expect(next.doc).not.toBe(state.doc)
    const element = currentSlide(next)!.elements.find((entry) => entry.id === id)
    expect(element?.kind === 'text' ? element.runs[0]?.text : null).toBe('Changed')
    expect(canUndo(next)).toBe(true)
  })

  it('removes selected layers and clamps the selection', () => {
    const state = createEditorState(buildBlankPresentation())
    const layer = createTextLayer()
    const added = addLayer(state, layer)
    const removed = removeSelectedLayers(added)

    expect(currentSlide(removed)!.elements.some((entry) => entry.id === layer.id)).toBe(false)
    expect(removed.selection).toEqual([])
  })

  it('reorders layers in z order', () => {
    const state = createEditorState(buildBlankPresentation())
    const first = currentSlide(state)!.elements[0]!
    const second = createShapeLayer()
    const added = addLayer(state, second)

    const moved = reorderLayer(added, first.id, 1)
    expect(orderedElements(currentSlide(moved)!).map((entry) => entry.id)).toEqual([
      second.id,
      first.id,
    ])
    expect(orderedElements(currentSlide(moved)!).map((entry) => entry.z)).toEqual([0, 1])

    const clamped = reorderLayer(moved, second.id, -5)
    expect(orderedElements(currentSlide(clamped)!).map((entry) => entry.id)).toEqual([
      second.id,
      first.id,
    ])
  })
})

describe('selection', () => {
  it('selects one, many and toggles with additive selection', () => {
    let state = createEditorState(buildBlankPresentation())
    const first = currentSlide(state)!.elements[0]!
    const second = createTextLayer({ text: 'Second' })
    state = addLayer(state, second)

    state = selectLayer(state, first.id)
    expect(state.selection).toEqual([first.id])

    state = selectLayer(state, second.id, true)
    expect(state.selection).toEqual([first.id, second.id])

    state = selectLayer(state, first.id, true)
    expect(state.selection).toEqual([second.id])

    state = selectAllLayers(state)
    expect(state.selection).toHaveLength(2)

    state = clearSelection(state)
    expect(state.selection).toEqual([])

    expect(selectedElements(selectLayers(state, [first.id, 'missing', first.id]))).toHaveLength(1)
  })

  it('clears selection when switching slides and clamps stale ids', () => {
    const doc = twoSlideDoc()
    const state = createEditorState(doc)
    const id = currentSlide(state)!.elements[0]!.id
    const selected = selectLayer(state, id)
    const switched = setSlide(selected, 'slide_b')

    expect(switched.slideId).toBe('slide_b')
    expect(switched.selection).toEqual([])

    const stale = { ...switched, selection: [id, 'missing'] }
    expect(clampSelection(stale).selection).toEqual([])
  })

  it('ignores selection of elements that are not on the active slide', () => {
    const state = createEditorState(twoSlideDoc())
    const next = selectLayer(state, 'missing')
    expect(next).toBe(state)
  })
})

describe('copy, paste and duplicate', () => {
  it('copies and pastes elements with new ids and an offset', () => {
    const state = createEditorState(buildBlankPresentation())
    const source = currentSlide(state)!.elements[0]!
    const copied = copySelectedLayers(selectLayer(state, source.id))
    expect(copied.clipboard).toHaveLength(1)

    const pasted = pasteLayers(copied)
    const elements = currentSlide(pasted)!.elements
    expect(elements).toHaveLength(2)
    const pastedElement = elements[1]!
    expect(pastedElement.id).not.toBe(source.id)
    expect(pastedElement.frame.x).toBeCloseTo(source.frame.x + 0.02)
    expect(pastedElement.frame.y).toBeCloseTo(source.frame.y + 0.02)
    expect(pasted.selection).toEqual([pastedElement.id])
    expect(documentSnapshot(state.doc)).toBe(documentSnapshot(copied.doc))
  })

  it('pastes into the active slide after switching slides', () => {
    const state = createEditorState(twoSlideDoc())
    const source = currentSlide(state)!.elements[0]!
    const copied = copySelectedLayers(selectLayer(state, source.id))
    const moved = setSlide(copied, 'slide_b')
    const pasted = pasteLayers(moved)

    expect(currentSlide(pasted)!.id).toBe('slide_b')
    expect(currentSlide(pasted)!.elements).toHaveLength(2)
    expect(pasted.doc.slides[0]?.elements).toHaveLength(1)
  })

  it('duplicates the selection and selects the copies', () => {
    const state = createEditorState(buildBlankPresentation())
    const source = currentSlide(state)!.elements[0]!
    const duplicated = duplicateSelectedLayers(selectLayer(state, source.id))
    const elements = currentSlide(duplicated)!.elements

    expect(elements).toHaveLength(2)
    const copy = elements[1]!
    expect(copy.id).not.toBe(source.id)
    expect(copy.frame.x).toBeCloseTo(source.frame.x + 0.02)
    expect(duplicated.selection).toEqual([copy.id])
  })
})

describe('undo and redo', () => {
  it('undoes and redoes a layer edit', () => {
    const state = createEditorState(buildBlankPresentation())
    const layer = createShapeLayer()
    const added = addLayer(state, layer)
    const undone = undo(added)

    expect(currentSlide(undone)!.elements).toHaveLength(1)
    expect(canRedo(undone)).toBe(true)
    expect(undone.selection).toEqual([])

    const redone = redo(undone)
    expect(currentSlide(redone)!.elements).toHaveLength(2)
    expect(redone.selection).toEqual([layer.id])
    expect(canRedo(redone)).toBe(false)
  })

  it('clears the redo stack after a new edit', () => {
    const state = createEditorState(buildBlankPresentation())
    const added = addLayer(state, createShapeLayer())
    const undone = undo(added)
    const edited = addLayer(undone, createTextLayer({ text: 'Fresh' }))

    expect(canRedo(edited)).toBe(false)
  })

  it('undoes document-level updates such as slide moves', () => {
    const state = createEditorState(twoSlideDoc())
    const reordered = updateDocument(state, (doc) => ({
      ...doc,
      slides: [...doc.slides].reverse(),
    }))

    expect(reordered.doc.slides[0]?.id).toBe('slide_b')
    expect(undo(reordered).doc.slides[0]?.id).toBe('slide_a')
  })
})
