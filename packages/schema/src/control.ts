import { z } from 'zod'
import { outputModeSchema } from './live'

export const frameRateSchema = z.enum(['23.976', '24', '25', '29.97', '29.97df', '30'])
export type FrameRate = z.infer<typeof frameRateSchema>

export const timecodeSchema = z.object({
  hours: z.number().int().min(0).max(23),
  minutes: z.number().int().min(0).max(59),
  seconds: z.number().int().min(0).max(59),
  frames: z.number().int().min(0).max(29),
  rate: frameRateSchema,
})
export type Timecode = z.infer<typeof timecodeSchema>

export const timecodeSourceSchema = z.enum(['ltc', 'mtc'])
export type TimecodeSource = z.infer<typeof timecodeSourceSchema>

export const timecodeSnapshotSchema = z.object({
  timecode: timecodeSchema.nullable(),
  locked: z.boolean(),
  source: timecodeSourceSchema.nullable(),
})
export type TimecodeSnapshot = z.infer<typeof timecodeSnapshotSchema>

export const controlCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('next') }),
  z.object({ type: z.literal('prev') }),
  z.object({ type: z.literal('nextItem') }),
  z.object({ type: z.literal('prevItem') }),
  z.object({ type: z.literal('previewNext') }),
  z.object({ type: z.literal('previewPrev') }),
  z.object({ type: z.literal('take') }),
  z.object({ type: z.literal('setMode'), mode: outputModeSchema }),
  z.object({ type: z.literal('timerStart'), timerId: z.string() }),
  z.object({ type: z.literal('timerStop'), timerId: z.string() }),
  z.object({ type: z.literal('timerReset'), timerId: z.string() }),
])
export type ControlCommand = z.infer<typeof controlCommandSchema>

export const midiBindingKindSchema = z.enum(['note', 'controlChange', 'programChange'])
export type MidiBindingKind = z.infer<typeof midiBindingKindSchema>

export const midiBindingSchema = z.object({
  id: z.string(),
  kind: midiBindingKindSchema,
  channel: z.number().int().min(0).max(15).nullable(),
  number: z.number().int().min(0).max(127),
  command: controlCommandSchema,
  label: z.string().default(''),
})
export type MidiBinding = z.infer<typeof midiBindingSchema>

export const midiPortInfoSchema = z.object({
  index: z.number().int().nonnegative(),
  name: z.string(),
})
export type MidiPortInfo = z.infer<typeof midiPortInfoSchema>

export const controlSourceSchema = z.enum(['midi', 'ltc', 'mtc'])
export type ControlSource = z.infer<typeof controlSourceSchema>

export const controlEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('command'),
    command: controlCommandSchema,
    source: controlSourceSchema,
    bindingId: z.string().nullable(),
  }),
  z.object({ type: z.literal('learned'), binding: midiBindingSchema }),
  z.object({ type: z.literal('message'), message: z.unknown() }),
  z.object({ type: z.literal('timecode'), snapshot: timecodeSnapshotSchema }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export type ControlEvent = z.infer<typeof controlEventSchema>
