import type { MidiBinding } from '@lumen/schema'
import { describe, expect, it } from 'vitest'
import { loadBindings, mergeBindings, normalizeBindings, saveBindings } from './bindings'

function binding(overrides: Partial<MidiBinding> = {}): MidiBinding {
  return {
    id: 'binding-1',
    kind: 'note',
    channel: 0,
    number: 36,
    command: { type: 'take' },
    label: 'Take',
    ...overrides,
  }
}

describe('normalizeBindings', () => {
  it('returns an empty list for non-array payloads', () => {
    expect(normalizeBindings(null)).toEqual([])
    expect(normalizeBindings(undefined)).toEqual([])
    expect(normalizeBindings({})).toEqual([])
    expect(normalizeBindings('note 36')).toEqual([])
    expect(normalizeBindings(42)).toEqual([])
  })

  it('keeps valid bindings and defaults a missing label', () => {
    const { label: _label, ...withoutLabel } = binding()
    expect(normalizeBindings([binding(), withoutLabel])).toEqual([
      binding(),
      { ...withoutLabel, label: '' },
    ])
  })

  it('drops invalid entries instead of failing the whole payload', () => {
    const invalid = [
      binding({ id: 'bad-kind', kind: 'pitchBend' as MidiBinding['kind'] }),
      binding({ id: 'bad-channel', channel: 16 }),
      binding({ id: 'bad-number', number: 128 }),
      binding({ id: 'bad-command', command: { type: 'explode' } as unknown as MidiBinding['command'] }),
      null,
      'binding',
    ]
    expect(normalizeBindings([binding(), ...invalid])).toEqual([binding()])
  })

  it('keeps the first binding for a duplicate id', () => {
    const first = binding({ label: 'First' })
    const second = binding({ label: 'Second' })
    expect(normalizeBindings([first, second])).toEqual([first])
  })
})

describe('mergeBindings', () => {
  it('prefers backend bindings when the backend has any', () => {
    const backend = [binding({ id: 'backend' })]
    const stored = [binding({ id: 'stored' })]
    expect(mergeBindings(backend, stored)).toEqual(backend)
  })

  it('restores stored bindings when the backend is empty', () => {
    const stored = [binding({ id: 'stored' })]
    expect(mergeBindings([], stored)).toEqual(stored)
  })

  it('ignores an invalid stored payload', () => {
    expect(mergeBindings([], { midiBindings: [binding()] })).toEqual([])
    expect(mergeBindings([], [binding({ channel: 99 })])).toEqual([])
  })

  it('still prefers the backend when the stored payload is invalid', () => {
    const backend = [binding({ id: 'backend' })]
    expect(mergeBindings(backend, 'garbage')).toEqual(backend)
  })
})

describe('store access outside Tauri', () => {
  it('loads an empty list without touching the Tauri store', async () => {
    await expect(loadBindings()).resolves.toEqual([])
  })

  it('saves as a no-op without throwing', async () => {
    await expect(saveBindings([binding()])).resolves.toBeUndefined()
  })
})
