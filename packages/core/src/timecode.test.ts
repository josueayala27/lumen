import { describe, expect, it } from 'vitest'
import {
  formatTimecode,
  frameCount,
  isValidTimecode,
  parseTimecode,
  timecodeFromFrames,
} from './timecode'

describe('SMPTE timecode math', () => {
  it('round-trips non-drop timecode', () => {
    const timecode = parseTimecode('01:02:03:04', '25')
    expect(timecode).not.toBeNull()
    expect(formatTimecode(timecode!)).toBe('01:02:03:04')
    expect(frameCount(timecode!)).toBe(3_723 * 25 + 4)
    expect(timecodeFromFrames(frameCount(timecode!), '25')).toEqual(timecode)
  })

  it('handles 29.97 drop-frame labels', () => {
    expect(timecodeFromFrames(1_800, '29.97df')).toEqual({
      hours: 0,
      minutes: 1,
      seconds: 0,
      frames: 2,
      rate: '29.97df',
    })
    expect(formatTimecode(timecodeFromFrames(17_982, '29.97df'))).toBe('00:10:00;00')
  })

  it('rejects dropped labels and bad ranges', () => {
    expect(parseTimecode('00:01:00;00', '29.97df')).toBeNull()
    expect(parseTimecode('00:60:00:00', '25')).toBeNull()
    expect(parseTimecode('00:00:00:25', '25')).toBeNull()
    expect(parseTimecode('1:00:00:00', '25')).toBeNull()
    expect(isValidTimecode({ hours: 0, minutes: 10, seconds: 0, frames: 0, rate: '29.97df' })).toBe(
      true,
    )
  })

  it('formats drop-frame with a semicolon', () => {
    const timecode = { hours: 1, minutes: 2, seconds: 3, frames: 4, rate: '29.97df' as const }
    expect(formatTimecode(timecode)).toBe('01:02:03;04')
  })
})
