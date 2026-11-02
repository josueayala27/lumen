import { createScreen, displayTarget } from '@lumen/core'
import { describe, expect, it } from 'vitest'
import type { DisplayInfo } from '~/output/api'
import { screenStatus, targetLabel } from './screenStatus'
import { testPatternKeys } from './useScreenOutputs'

const display: DisplayInfo = { index: 1, name: 'Projector', width: 1920, height: 1080, scale_factor: 1, x: 1920, y: 0, primary: false }
const ref = { name: 'Projector', x: 1920, y: 0, width: 1920, height: 1080 }

describe('screenStatus', () => {
  it('reports off, virtual, offline, ready and live', () => {
    const virtual = createScreen()
    expect(screenStatus({ ...virtual, enabled: false }, [], () => null).kind).toBe('off')
    expect(screenStatus(virtual, [], () => null).kind).toBe('virtual')
    const projector = createScreen({ target: displayTarget(ref) })
    expect(screenStatus(projector, [], () => null).kind).toBe('offline')
    expect(screenStatus(projector, [display], () => null).kind).toBe('ready')
    expect(screenStatus(projector, [display], () => ({ label: 'out-1', display_index: 1, width: 1920, height: 1080 })).kind).toBe('live')
  })

  it('labels the target', () => {
    expect(targetLabel(createScreen())).toBe('Virtual')
    expect(targetLabel(createScreen({ target: displayTarget(ref) }))).toBe('Projector')
  })
})

describe('testPatternKeys', () => {
  it('keys only enabled screens with a pattern and an open output', () => {
    const a = { ...createScreen({ id: 'a', name: 'A' }), testPattern: 'identify' as const }
    const b = { ...createScreen({ id: 'b', name: 'B' }), testPattern: 'bars' as const, enabled: false }
    const c = createScreen({ id: 'c', name: 'C' })
    const d = { ...createScreen({ id: 'd', name: 'D' }), testPattern: 'grid' as const }
    const keys = testPatternKeys([a, b, c, d], (screen) => (screen.id === 'd' ? null : 'out-1'))
    expect([...keys]).toEqual([['a', 'out-1:identify:A']])
  })
})
