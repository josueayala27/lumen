import { invoke } from '@tauri-apps/api/core'
import type { Composition, Scene, Screen, Transition } from '@lumen/schema'

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

/** What `apply_composition` did with one screen. Field names match the Rust serialization. */
export interface ScreenOutputStatus {
  screenId: string
  /** Output window label when the screen drives a native output. */
  label: string | null
  /** Why the screen has no output: not a display target, monitor missing, open failed. */
  error: string | null
}

/**
 * Sends a composition to one native output per display screen (render
 * contract v2). Rust opens a missing output for each enabled screen, renders
 * disabled screens with an open output black, and applies each screen's
 * layout, mapping, blackout and test pattern. `transition` animates layer
 * source changes and slide revisions; null cuts.
 */
export function applyComposition(
  composition: Composition,
  screens: readonly Screen[],
  transition: Transition | null = null,
): Promise<ScreenOutputStatus[]> {
  return invoke('apply_composition', { composition, screens, transition })
}

/** Starts the next cue's videos paused on their first frame; `null` releases them. */
export function preloadScene(scene: Scene | null): Promise<void> {
  return invoke('preload_scene', { scene })
}

/** A transport change for one video; omitted fields are kept. */
export interface VideoTransportCommand {
  playing?: boolean
  positionMs?: number
  rate?: number
}

/** Plays, pauses, seeks or re-rates one video asset on the outputs and preview. */
export function videoTransport(assetId: string, command: VideoTransportCommand): Promise<void> {
  return invoke('video_transport', {
    assetId,
    playing: command.playing ?? null,
    positionMs: command.positionMs === undefined ? null : Math.max(0, Math.round(command.positionMs)),
    rate: command.rate ?? null,
  })
}
