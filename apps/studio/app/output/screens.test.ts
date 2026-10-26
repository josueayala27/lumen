import { describe, expect, it } from 'vitest'
import type { DisplayInfo } from './api'
import {
  defaultAudienceDisplay,
  displayMeta,
  isAssignedScreen,
  normalizeOutputSettings,
  resolveDisplay,
  screenRef,
} from './screens'

function display(overrides: Partial<DisplayInfo> = {}): DisplayInfo {
  return {
    index: 0,
    name: 'Built-in Retina Display',
    width: 2560,
    height: 1440,
    scale_factor: 2,
    x: 0,
    y: 0,
    primary: true,
    ...overrides,
  }
}

const projector = display({
  index: 1,
  name: 'PROJECTOR',
  width: 1920,
  height: 1080,
  scale_factor: 1,
  x: 2560,
  y: 0,
  primary: false,
})

describe('normalizeOutputSettings', () => {
  it('returns empty settings for non-object payloads', () => {
    expect(normalizeOutputSettings(null)).toEqual({ audience: null })
    expect(normalizeOutputSettings(undefined)).toEqual({ audience: null })
    expect(normalizeOutputSettings([])).toEqual({ audience: null })
    expect(normalizeOutputSettings('PROJECTOR')).toEqual({ audience: null })
  })

  it('keeps a complete audience screen', () => {
    const screen = screenRef(projector)
    expect(normalizeOutputSettings({ audience: screen })).toEqual({ audience: screen })
  })

  it('drops a screen with an invalid name or position', () => {
    const screen = screenRef(projector)
    expect(normalizeOutputSettings({ audience: { ...screen, name: '' } })).toEqual({ audience: null })
    expect(normalizeOutputSettings({ audience: { ...screen, x: 'left' } })).toEqual({ audience: null })
    expect(normalizeOutputSettings({ audience: { name: 'PROJECTOR' } })).toEqual({ audience: null })
  })
})

describe('resolveDisplay', () => {
  const displays = [display(), projector]

  it('matches a saved screen by name and position', () => {
    expect(resolveDisplay(displays, { ...screenRef(projector), x: 9999 })).toEqual(projector)
    expect(resolveDisplay(displays, screenRef(projector))).toEqual(projector)
  })

  it('falls back to the primary display when the saved monitor is gone', () => {
    expect(
      resolveDisplay(displays, { name: 'GONE', x: 0, y: 0, width: 800, height: 600 }),
    ).toEqual(display())
  })

  it('defaults to the first non-primary display', () => {
    expect(resolveDisplay(displays, null)).toEqual(projector)
    expect(defaultAudienceDisplay(displays)).toEqual(projector)
  })

  it('returns the primary display when it is the only one', () => {
    expect(resolveDisplay([display()], null)).toEqual(display())
    expect(defaultAudienceDisplay([])).toBeNull()
    expect(resolveDisplay([], null)).toBeNull()
  })
})

describe('isAssignedScreen', () => {
  it('requires both name and position to match', () => {
    expect(isAssignedScreen(projector, screenRef(projector))).toBe(true)
    expect(isAssignedScreen(projector, { ...screenRef(projector), x: 0 })).toBe(false)
    expect(isAssignedScreen(projector, null)).toBe(false)
  })
})

describe('displayMeta', () => {
  it('shows resolution, scale and position', () => {
    expect(displayMeta(projector)).toBe('1920×1080 · 1× · 2560,0')
    expect(displayMeta(display({ scale_factor: 1.5 }))).toContain('1.5×')
  })
})
