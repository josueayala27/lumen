import { invoke } from '@tauri-apps/api/core'
import type {
  ControlCommand,
  FrameRate,
  MidiBinding,
  MidiPortInfo,
  TimecodeSnapshot,
} from '@lumen/schema'

export function listMidiInputs(): Promise<MidiPortInfo[]> {
  return invoke('list_midi_inputs')
}

export function startMidiInput(port: string): Promise<void> {
  return invoke('start_midi_input', { port })
}

export function stopMidiInput(): Promise<void> {
  return invoke('stop_midi_input')
}

export function getMidiBindings(): Promise<MidiBinding[]> {
  return invoke('get_midi_bindings')
}

export function setMidiBindings(bindings: MidiBinding[]): Promise<void> {
  return invoke('set_midi_bindings', { bindings })
}

export function beginMidiLearn(command: ControlCommand, label = ''): Promise<string> {
  return invoke('begin_midi_learn', { command, label })
}

export function cancelMidiLearn(): Promise<void> {
  return invoke('cancel_midi_learn')
}

export function listAudioInputs(): Promise<string[]> {
  return invoke('list_audio_inputs')
}

export function startLtcInput(device: string | null, rate: FrameRate): Promise<void> {
  return invoke('start_ltc_input', { device, rate })
}

export function stopLtcInput(): Promise<void> {
  return invoke('stop_ltc_input')
}

export function timecodeState(): Promise<TimecodeSnapshot> {
  return invoke('timecode_state')
}
