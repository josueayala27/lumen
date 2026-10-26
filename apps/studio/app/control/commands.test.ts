import { describe, expect, it } from 'vitest'
import { toLiveCommand } from './commands'

describe('toLiveCommand', () => {
  it('passes navigation commands through', () => {
    expect(toLiveCommand({ type: 'next' })).toEqual({ type: 'next' })
    expect(toLiveCommand({ type: 'setMode', mode: 'black' })).toEqual({ type: 'setMode', mode: 'black' })
  })

  it('stamps timer commands with the desktop clock', () => {
    expect(toLiveCommand({ type: 'timerStart', timerId: 't1' }, 1_000)).toEqual({
      type: 'timerStart',
      timerId: 't1',
      now: 1_000,
    })
    expect(toLiveCommand({ type: 'timerStop', timerId: 't1' }, 2_000)).toEqual({
      type: 'timerStop',
      timerId: 't1',
      now: 2_000,
    })
    expect(toLiveCommand({ type: 'timerReset', timerId: 't1' })).toEqual({
      type: 'timerReset',
      timerId: 't1',
    })
  })
})
