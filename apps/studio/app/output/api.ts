import { invoke } from '@tauri-apps/api/core'

/** A monitor as reported by `lumen-output`. Field names match the Rust serialization. */
export interface DisplayInfo {
  index: number
  name: string
  width: number
  height: number
  scale_factor: number
  x: number
  y: number
  primary: boolean
}

/** An open native audience window. */
export interface OutputWindow {
  label: string
  display_index: number
  width: number
  height: number
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export function listDisplays(): Promise<DisplayInfo[]> {
  return invoke('list_displays')
}

export function listOutputs(): Promise<OutputWindow[]> {
  return invoke('list_outputs')
}

export function openOutput(displayIndex: number): Promise<OutputWindow> {
  return invoke('open_output', { displayIndex })
}

export function closeOutput(label: string): Promise<void> {
  return invoke('close_output', { label })
}
