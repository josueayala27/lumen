import type { Element, Frame, Paint, PresentationDoc, Slide, TextStyle } from '@lumen/schema'
import { newId } from './presentation'

export type TextElement = Extract<Element, { kind: 'text' }>
export type ShapeElement = Extract<Element, { kind: 'shape' }>

/** Point-in-time editor state. Held snapshots share immutable documents. */
export interface EditorSnapshot {
  doc: PresentationDoc
  slideId: string
  selection: string[]
}

/**
 * Local editor state around one document. Every mutating helper returns a new
 * state and never mutates the document or the supplied state.
 */
export interface EditorState {
  doc: PresentationDoc
  /** Active slide id. */
  slideId: string
  /** Selected element ids on the active slide. */
  selection: string[]
  /** Copied elements, independent of the source slide. */
  clipboard: Element[]
  undoStack: EditorSnapshot[]
  redoStack: EditorSnapshot[]
}

export interface TextLayerInput {
  text?: string
  id?: string
  frame?: Partial<Frame>
  style?: Partial<TextStyle>
  opacity?: number
}

export interface ShapeLayerInput {
  id?: string
  frame?: Partial<Frame>
  fill?: Paint
  stroke?: Paint | null
  strokeWidth?: number
  radius?: number
  opacity?: number
}

const HISTORY_LIMIT = 100

const DEFAULT_FRAME: Frame = { x: 0.15, y: 0.3, w: 0.7, h: 0.2, rotation: 0 }
const DEFAULT_TEXT_STYLE: TextStyle = {
  fontId: 'inter',
  fontSize: 64,
  weight: 600,
  italic: false,
  color: '#ffffff',
  align: 'center',
  lineHeight: 1.15,
  letterSpacing: 0,
}

export function createTextLayer(input: TextLayerInput = {}): TextElement {
  const text = input.text ?? 'New text'
  return {
    kind: 'text',
    id: input.id ?? newId('element'),
    frame: { ...DEFAULT_FRAME, ...input.frame },
    z: 0,
    opacity: input.opacity ?? 1,
    runs: [{ text, bold: false, italic: false, underline: false, color: null }],
    style: { ...DEFAULT_TEXT_STYLE, ...input.style },
    layout: {
      align: 'center',
      vAlign: 'middle',
      lineHeight: 1.15,
      letterSpacing: 0,
      fit: 'wrap',
      padding: 0,
      maxLines: null,
    },
    effects: { shadow: null, outline: null },
  }
}

export function createShapeLayer(input: ShapeLayerInput = {}): ShapeElement {
  return {
    kind: 'shape',
    id: input.id ?? newId('element'),
    frame: { ...DEFAULT_FRAME, ...input.frame },
    z: 0,
    opacity: input.opacity ?? 1,
    fill: input.fill ?? { kind: 'solid', color: '#6366f1' },
    stroke: input.stroke ?? null,
    strokeWidth: input.strokeWidth ?? 0,
    radius: input.radius ?? 24,
  }
}

export function createEditorState(doc: PresentationDoc, slideId?: string): EditorState {
  const first = doc.slides[0]?.id ?? ''
  const active =
    slideId && doc.slides.some((slide) => slide.id === slideId) ? slideId : first
  return {
    doc,
    slideId: active,
    selection: [],
    clipboard: [],
    undoStack: [],
    redoStack: [],
  }
}

export function currentSlide(state: EditorState): Slide | null {
  return state.doc.slides.find((slide) => slide.id === state.slideId) ?? null
}

/** Elements sorted bottom-to-top by z, ties kept in document order. */
export function orderedElements(slide: Slide): Element[] {
  return slide.elements
    .map((element, index) => ({ element, index }))
    .sort((a, b) => a.element.z - b.element.z || a.index - b.index)
    .map((entry) => entry.element)
}

export function selectedElements(state: EditorState): Element[] {
  const slide = currentSlide(state)
  if (!slide || state.selection.length === 0) return []
  const selected = new Set(state.selection)
  return orderedElements(slide).filter((element) => selected.has(element.id))
}

export function canUndo(state: EditorState): boolean {
  return state.undoStack.length > 0
}

export function canRedo(state: EditorState): boolean {
  return state.redoStack.length > 0
}

export function selectLayer(state: EditorState, id: string, additive = false): EditorState {
  const slide = currentSlide(state)
  if (!slide || !slide.elements.some((element) => element.id === id)) return state

  if (!additive) {
    if (state.selection.length === 1 && state.selection[0] === id) return state
    return { ...state, selection: [id] }
  }

  const selection = state.selection.includes(id)
    ? state.selection.filter((entry) => entry !== id)
    : [...state.selection, id]
  return { ...state, selection }
}

export function selectLayers(state: EditorState, ids: string[]): EditorState {
  const slide = currentSlide(state)
  if (!slide) return state
  const present = new Set(slide.elements.map((element) => element.id))
  const selection = ids.filter((id, index) => present.has(id) && ids.indexOf(id) === index)
  return { ...state, selection }
}

export function selectAllLayers(state: EditorState): EditorState {
  const slide = currentSlide(state)
  if (!slide) return state
  return { ...state, selection: slide.elements.map((element) => element.id) }
}

export function clearSelection(state: EditorState): EditorState {
  return state.selection.length === 0 ? state : { ...state, selection: [] }
}

/**
 * Drops selection ids that no longer exist on the active slide, and switches to
 * the first slide when the active id is gone. Returns the same state when valid.
 */
export function clampSelection(state: EditorState): EditorState {
  const slide = currentSlide(state)
  const fallback = state.doc.slides[0] ?? null
  const active = slide ?? fallback
  const slideId = active?.id ?? ''
  const present = new Set(active?.elements.map((element) => element.id) ?? [])

  const selection: string[] = []
  for (const id of state.selection) {
    if (present.has(id) && !selection.includes(id)) selection.push(id)
  }

  const unchanged =
    state.slideId === slideId &&
    selection.length === state.selection.length &&
    selection.every((id, index) => id === state.selection[index])
  return unchanged ? state : { ...state, slideId, selection }
}

export function setSlide(state: EditorState, slideId: string): EditorState {
  if (state.slideId === slideId) return state
  if (!state.doc.slides.some((slide) => slide.id === slideId)) return state
  return clampSelection({ ...state, slideId, selection: [] })
}

export function addLayer(state: EditorState, element: Element): EditorState {
  const slide = currentSlide(state)
  if (!slide) return state
  const added = { ...element, z: nextZ(slide) } as Element
  return updateSlideElements(state, slide.id, (elements) => [...elements, added], [added.id])
}

export function updateLayer(
  state: EditorState,
  id: string,
  update: (element: Element) => Element,
): EditorState {
  const slide = currentSlide(state)
  if (!slide) return state
  const element = slide.elements.find((entry) => entry.id === id)
  if (!element) return state

  const next = { ...update(element), id } as Element
  return updateSlideElements(state, slide.id, (elements) =>
    elements.map((entry) => (entry.id === id ? next : entry)),
  )
}

export function removeLayers(state: EditorState, ids: string[]): EditorState {
  const slide = currentSlide(state)
  if (!slide || ids.length === 0) return state
  const removed = new Set(ids)
  if (!slide.elements.some((element) => removed.has(element.id))) return state

  return updateSlideElements(
    state,
    slide.id,
    (elements) => elements.filter((element) => !removed.has(element.id)),
    state.selection.filter((id) => !removed.has(id)),
  )
}

export function removeSelectedLayers(state: EditorState): EditorState {
  return removeLayers(state, state.selection)
}

/** Moves a layer `delta` steps in z order. Positive brings it forward. */
export function reorderLayer(state: EditorState, id: string, delta: number): EditorState {
  const slide = currentSlide(state)
  if (!slide || delta === 0) return state

  const ordered = orderedElements(slide)
  const from = ordered.findIndex((element) => element.id === id)
  if (from < 0) return state

  const to = Math.max(0, Math.min(ordered.length - 1, from + delta))
  if (to === from) return state

  const next = ordered.slice()
  const [moved] = next.splice(from, 1)
  if (!moved) return state
  next.splice(to, 0, moved)

  const zById = new Map(next.map((element, index) => [element.id, index]))
  const elements = slide.elements.map((element) => ({
    ...element,
    z: zById.get(element.id) ?? element.z,
  }))
  return updateSlideElements(state, slide.id, () => elements)
}

export function duplicateLayers(
  state: EditorState,
  ids: string[] = state.selection,
): EditorState {
  const slide = currentSlide(state)
  if (!slide || ids.length === 0) return state

  const wanted = new Set(ids)
  const sources = orderedElements(slide).filter((element) => wanted.has(element.id))
  if (sources.length === 0) return state

  const baseZ = nextZ(slide)
  const copies = sources.map((element, index) => {
    const copy = cloneElement(element)
    copy.id = newId('element')
    copy.frame = offsetFrame(copy.frame, 0.02 * (index + 1))
    copy.z = baseZ + index
    return copy
  })

  return updateSlideElements(
    state,
    slide.id,
    (elements) => [...elements, ...copies],
    copies.map((element) => element.id),
  )
}

export function duplicateSelectedLayers(state: EditorState): EditorState {
  return duplicateLayers(state, state.selection)
}

export function copyLayers(state: EditorState, ids: string[] = state.selection): EditorState {
  const slide = currentSlide(state)
  if (!slide || ids.length === 0) return state

  const wanted = new Set(ids)
  const elements = orderedElements(slide)
    .filter((element) => wanted.has(element.id))
    .map(cloneElement)
  return elements.length === 0 ? state : { ...state, clipboard: elements }
}

export function copySelectedLayers(state: EditorState): EditorState {
  return copyLayers(state, state.selection)
}

export function pasteLayers(state: EditorState): EditorState {
  const slide = currentSlide(state)
  if (!slide || state.clipboard.length === 0) return state

  const baseZ = nextZ(slide)
  const pasted = state.clipboard.map((element, index) => {
    const copy = cloneElement(element)
    copy.id = newId('element')
    copy.frame = offsetFrame(copy.frame)
    copy.z = baseZ + index
    return copy
  })

  return updateSlideElements(
    state,
    slide.id,
    (elements) => [...elements, ...pasted],
    pasted.map((element) => element.id),
  )
}

export function undo(state: EditorState): EditorState {
  const previous = state.undoStack[state.undoStack.length - 1]
  if (!previous) return state

  return clampSelection({
    ...state,
    doc: previous.doc,
    slideId: previous.slideId,
    selection: previous.selection,
    undoStack: state.undoStack.slice(0, -1),
    redoStack: pushSnapshot(state.redoStack, snapshot(state)),
  })
}

export function redo(state: EditorState): EditorState {
  const next = state.redoStack[state.redoStack.length - 1]
  if (!next) return state

  return clampSelection({
    ...state,
    doc: next.doc,
    slideId: next.slideId,
    selection: next.selection,
    undoStack: pushSnapshot(state.undoStack, snapshot(state)),
    redoStack: state.redoStack.slice(0, -1),
  })
}

/** Replaces the document through an updater and records one undo step. */
export function updateDocument(
  state: EditorState,
  update: (doc: PresentationDoc) => PresentationDoc,
  nextSlideId = state.slideId,
): EditorState {
  const doc = update(state.doc)
  if (doc === state.doc) return state
  return commit(state, doc, nextSlideId, state.selection)
}

function snapshot(state: EditorState): EditorSnapshot {
  return { doc: state.doc, slideId: state.slideId, selection: [...state.selection] }
}

function pushSnapshot(stack: EditorSnapshot[], entry: EditorSnapshot): EditorSnapshot[] {
  return [...stack, entry].slice(-HISTORY_LIMIT)
}

function commit(
  state: EditorState,
  doc: PresentationDoc,
  slideId: string,
  selection: string[],
): EditorState {
  if (doc === state.doc) return state
  return clampSelection({
    ...state,
    doc,
    slideId,
    selection,
    undoStack: pushSnapshot(state.undoStack, snapshot(state)),
    redoStack: [],
  })
}

function updateSlideElements(
  state: EditorState,
  slideId: string,
  update: (elements: Element[]) => Element[],
  selection: string[] = state.selection,
): EditorState {
  const slide = state.doc.slides.find((entry) => entry.id === slideId)
  if (!slide) return state

  const elements = update(slide.elements)
  if (elements === slide.elements) return state

  const doc: PresentationDoc = {
    ...state.doc,
    slides: state.doc.slides.map((entry) =>
      entry.id === slideId ? { ...entry, elements } : entry,
    ),
  }
  return commit(state, doc, slideId, selection)
}

function nextZ(slide: Slide): number {
  return slide.elements.reduce((max, element) => Math.max(max, element.z), -1) + 1
}

function offsetFrame(frame: Frame, dx = 0.02, dy = 0.02): Frame {
  return { ...frame, x: clamp01(frame.x + dx), y: clamp01(frame.y + dy) }
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

function cloneElement(element: Element): Element {
  if (typeof structuredClone === 'function') return structuredClone(element)
  return JSON.parse(JSON.stringify(element)) as Element
}
