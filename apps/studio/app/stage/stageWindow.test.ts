import { describe, expect, it } from 'vitest'
import { stageKeyAction } from './stageWindow'

function key(init: KeyboardEventInit): KeyboardEvent {
  return new KeyboardEvent('keydown', init)
}

describe('stage window keys', () => {
  it('closes on Mod+W and toggles fullscreen on F', () => {
    expect(stageKeyAction(key({ key: 'w', metaKey: true }), false, true)).toBe('close')
    expect(stageKeyAction(key({ key: 'w', ctrlKey: true }), false, false)).toBe('close')
    expect(stageKeyAction(key({ key: 'f' }), false, true)).toBe('toggle-fullscreen')
    expect(stageKeyAction(key({ key: 'w' }), false, true)).toBeNull()
  })

  it('leaves fullscreen on Escape but never closes on it', () => {
    expect(stageKeyAction(key({ key: 'Escape' }), true, true)).toBe('exit-fullscreen')
    expect(stageKeyAction(key({ key: 'Escape' }), false, true)).toBeNull()
  })
})
