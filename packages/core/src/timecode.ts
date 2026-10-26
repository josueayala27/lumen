import type { FrameRate, Timecode } from '@lumen/schema'

export function nominalFps(rate: FrameRate): number {
  switch (rate) {
    case '23.976':
    case '24':
      return 24
    case '25':
      return 25
    default:
      return 30
  }
}

export function isDropFrame(rate: FrameRate): boolean {
  return rate === '29.97df'
}

/** Timecode label to elapsed frame count. Drop-frame skips two labels per minute. */
export function frameCount(timecode: Timecode): number {
  const nominal = nominalFps(timecode.rate)
  const base =
    (timecode.hours * 3600 + timecode.minutes * 60 + timecode.seconds) * nominal + timecode.frames
  if (!isDropFrame(timecode.rate)) return base
  const totalMinutes = timecode.hours * 60 + timecode.minutes
  return base - 2 * (totalMinutes - Math.floor(totalMinutes / 10))
}

export function timecodeFromFrames(frames: number, rate: FrameRate): Timecode {
  let count = Math.max(0, Math.trunc(frames))
  if (isDropFrame(rate)) {
    const tenMinutes = 17_982
    const minute = 1_798
    const tens = Math.floor(count / tenMinutes)
    const remainder = count % tenMinutes
    count += 18 * tens + 2 * Math.floor(Math.max(0, remainder - 2) / minute)
  }
  const nominal = nominalFps(rate)
  const perHour = nominal * 3600
  const perMinute = nominal * 60
  return {
    hours: Math.floor(count / perHour) % 24,
    minutes: Math.floor((count % perHour) / perMinute),
    seconds: Math.floor((count % perMinute) / nominal),
    frames: count % nominal,
    rate,
  }
}

export function isValidTimecode(timecode: Timecode): boolean {
  if (timecode.hours > 23 || timecode.minutes > 59 || timecode.seconds > 59) return false
  if (timecode.frames >= nominalFps(timecode.rate)) return false
  if (
    isDropFrame(timecode.rate) &&
    timecode.seconds === 0 &&
    timecode.frames < 2 &&
    timecode.minutes % 10 !== 0
  ) {
    return false
  }
  return true
}

export function parseTimecode(input: string, rate: FrameRate): Timecode | null {
  const parts = input.trim().split(/[:;]/)
  if (parts.length !== 4 || parts.some((part) => !/^\d{2}$/.test(part))) return null
  const [hours, minutes, seconds, frames] = parts.map(Number) as [number, number, number, number]
  const timecode = { hours, minutes, seconds, frames, rate }
  return isValidTimecode(timecode) ? timecode : null
}

export function formatTimecode(timecode: Timecode): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const separator = isDropFrame(timecode.rate) ? ';' : ':'
  return `${pad(timecode.hours)}:${pad(timecode.minutes)}:${pad(timecode.seconds)}${separator}${pad(timecode.frames)}`
}
