import { describe, expect, it } from 'vitest'
import type { DisplayInfo } from '~/output/api'
import { createShowDoc, displayForScreen } from './showModel'

describe('displayForScreen', () => {
  const displays: DisplayInfo[] = [
    { index: 0, name: 'Built-in', width: 1512, height: 982, scale_factor: 2, x: 0, y: 0, primary: true },
    { index: 1, name: 'Projector', width: 1920, height: 1080, scale_factor: 1, x: 1512, y: 0, primary: false },
  ]

  it('matches name and position, then name, and never falls back', () => {
    const screen = createShowDoc().screens[0]!
    expect(displayForScreen(displays, screen)).toBeNull()
    const ref = { name: 'Projector', x: 9999, y: 0, width: 1920, height: 1080 }
    expect(displayForScreen(displays, { ...screen, target: { kind: 'display', ref } })?.index).toBe(1)
    const gone = { ...ref, name: 'Other' }
    expect(displayForScreen(displays, { ...screen, target: { kind: 'display', ref: gone } })).toBeNull()
  })
})
