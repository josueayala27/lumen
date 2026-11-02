import type { Point, Region } from '@lumen/schema'

/**
 * Pure maths for the Screens workspace: dragging and resizing screen regions
 * on the canvas, snapping their edges, and moving corner-pin and mesh points.
 * Every value is normalized (0..1 of the canvas or of the output).
 */

export type RegionHandle = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

export const RESIZE_HANDLES: readonly Exclude<RegionHandle, 'move'>[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** Smallest region side, so a region never collapses while resizing. */
export const MIN_REGION = 0.02

/** How far corner-pin and mesh points may leave the output. */
export const POINT_LIMIT = { min: -0.5, max: 1.5 }

export interface SnapGuide {
  axis: 'x' | 'y'
  position: number
}

export interface SnapTargets {
  x: number[]
  y: number[]
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round(value: number): number {
  return Math.round(value * 1e6) / 1e6
}

function tidy(region: Region): Region {
  return { x: round(region.x), y: round(region.y), w: round(region.w), h: round(region.h) }
}

/** Keeps a region inside the canvas and at least `min` wide and high. */
export function clampRegion(region: Region, min = MIN_REGION): Region {
  const w = clamp(Number.isFinite(region.w) ? region.w : 1, min, 1)
  const h = clamp(Number.isFinite(region.h) ? region.h : 1, min, 1)
  const x = clamp(Number.isFinite(region.x) ? region.x : 0, 0, 1 - w)
  const y = clamp(Number.isFinite(region.y) ? region.y : 0, 0, 1 - h)
  return tidy({ x, y, w, h })
}

/**
 * The region after dragging `handle` by `(dx, dy)` from `start`. Moving keeps
 * the size and stays on the canvas; resizing moves only the grabbed edges and
 * stops at the canvas edge and at `min`.
 */
export function dragRegion(start: Region, handle: RegionHandle, dx: number, dy: number, min = MIN_REGION): Region {
  if (handle === 'move') {
    return tidy({
      x: clamp(start.x + dx, 0, 1 - start.w),
      y: clamp(start.y + dy, 0, 1 - start.h),
      w: start.w,
      h: start.h,
    })
  }
  let left = start.x
  let right = start.x + start.w
  let top = start.y
  let bottom = start.y + start.h
  if (handle.includes('w')) left = clamp(left + dx, 0, right - min)
  if (handle.includes('e')) right = clamp(right + dx, left + min, 1)
  if (handle.includes('n')) top = clamp(top + dy, 0, bottom - min)
  if (handle.includes('s')) bottom = clamp(bottom + dy, top + min, 1)
  return tidy({ x: left, y: top, w: right - left, h: bottom - top })
}

/** Canvas edges, centre lines and the edges of every other region. */
export function snapTargets(others: readonly Region[]): SnapTargets {
  const x = new Set([0, 0.5, 1])
  const y = new Set([0, 0.5, 1])
  for (const region of others) {
    x.add(round(region.x))
    x.add(round(region.x + region.w))
    y.add(round(region.y))
    y.add(round(region.y + region.h))
  }
  return { x: [...x], y: [...y] }
}

/** The smallest offset that brings one of `edges` onto a target, within `threshold`. */
function nearest(edges: number[], targets: number[], threshold: number): { delta: number; position: number } | null {
  let best: { delta: number; position: number } | null = null
  for (const edge of edges) {
    for (const target of targets) {
      const delta = target - edge
      if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) best = { delta, position: target }
    }
  }
  return best
}

/**
 * Snaps the edges a drag moves onto nearby targets. Moving snaps the left,
 * centre or right edge (and top, middle or bottom); resizing snaps only the
 * grabbed edges. Returns the snapped region and the guides to draw.
 */
export function snapRegion(
  region: Region,
  handle: RegionHandle,
  targets: SnapTargets,
  threshold: number,
  min = MIN_REGION,
): { region: Region; guides: SnapGuide[] } {
  const guides: SnapGuide[] = []
  let { x, y, w, h } = region
  if (handle === 'move') {
    const sx = nearest([x, x + w / 2, x + w], targets.x, threshold)
    if (sx) {
      x += sx.delta
      guides.push({ axis: 'x', position: sx.position })
    }
    const sy = nearest([y, y + h / 2, y + h], targets.y, threshold)
    if (sy) {
      y += sy.delta
      guides.push({ axis: 'y', position: sy.position })
    }
    return { region: clampRegion({ x, y, w, h }, min), guides }
  }
  let left = x
  let right = x + w
  let top = y
  let bottom = y + h
  const snapEdge = (edge: number, axis: 'x' | 'y'): number => {
    const hit = nearest([edge], axis === 'x' ? targets.x : targets.y, threshold)
    if (!hit) return edge
    guides.push({ axis, position: hit.position })
    return hit.position
  }
  if (handle.includes('w')) left = Math.min(snapEdge(left, 'x'), right - min)
  if (handle.includes('e')) right = Math.max(snapEdge(right, 'x'), left + min)
  if (handle.includes('n')) top = Math.min(snapEdge(top, 'y'), bottom - min)
  if (handle.includes('s')) bottom = Math.max(snapEdge(bottom, 'y'), top + min)
  return { region: clampRegion({ x: left, y: top, w: right - left, h: bottom - top }, min), guides }
}

/** A point moved by `(dx, dy)`, kept within `POINT_LIMIT`. */
export function dragPoint(start: Point, dx: number, dy: number): Point {
  return {
    x: round(clamp(start.x + dx, POINT_LIMIT.min, POINT_LIMIT.max)),
    y: round(clamp(start.y + dy, POINT_LIMIT.min, POINT_LIMIT.max)),
  }
}

/** Replaces one point of a list, leaving the others untouched. */
export function replacePoint<T extends Point[]>(points: T, index: number, point: Point): T {
  if (index < 0 || index >= points.length) return points
  const next = [...points] as T
  next[index] = point
  return next
}

/** The pixel size of a region on a canvas, rounded. */
export function regionPixels(region: Region, canvas: { width: number; height: number }): { width: number; height: number } {
  return { width: Math.round(region.w * canvas.width), height: Math.round(region.h * canvas.height) }
}

/** Mesh grid lines as point-index lists: each row, then each column. */
export function meshLines(cols: number, rows: number): number[][] {
  const lines: number[][] = []
  for (let row = 0; row < rows; row += 1) lines.push(Array.from({ length: cols }, (_, col) => row * cols + col))
  for (let col = 0; col < cols; col += 1) lines.push(Array.from({ length: rows }, (_, row) => row * cols + col))
  return lines
}
