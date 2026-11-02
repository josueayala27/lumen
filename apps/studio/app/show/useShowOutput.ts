import type { OutputMode, Scene, Screen, ShowDoc, Transition } from '@lumen/schema'
import { ref, watch, type Ref } from 'vue'
import { sceneVideoKey, transitionPlan } from '~/live/liveScene'
import { applyScene, applyTransition, isTauri, preloadScene } from '~/output/api'
import { useOutputScreens } from '~/output/useOutputScreens'
import { outputAction, type OutputMemory } from './showLive'
import { displayForScreen } from './showModel'

export interface ShowOutputOptions {
  show: Readonly<Ref<ShowDoc>>
  /** The scene a screen shows on air right now. */
  scene: (screen: Screen) => Scene
  /** The scene a screen shows at the next rundown cue, for preloading. */
  nextScene?: (screen: Screen) => Scene | null
  mode: Readonly<Ref<OutputMode>>
  /** Rundown cue on air; a change while live crossfades with `transition`. */
  cueKey: Readonly<Ref<string>>
  transition: Readonly<Ref<Transition>>
  /** Any other input whose change needs the outputs updated. */
  version: () => unknown
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Sends each enabled show screen its own scene on the native output open on
 * its display (the v2 path; there is no single audience output). Rundown cue
 * changes crossfade, freeze holds the last frame, and the next cue's videos
 * are preloaded paused. Screens without a connected display, or whose
 * display has no open output, are skipped.
 */
export function useShowOutput(options: ShowOutputOptions) {
  const screens = useOutputScreens()
  const error = ref('')
  const memory = new Map<string, OutputMemory>()
  let preloadKey = ''
  let token = 0

  function outputLabel(screen: Screen): string | null {
    if (!screen.enabled) return null
    const display = displayForScreen(screens.displays.value, screen)
    return display ? (screens.outputFor(display.index)?.label ?? null) : null
  }

  function preload(scene: Scene | null): void {
    const key = scene ? sceneVideoKey(scene) : ''
    if (key === preloadKey) return
    preloadKey = key
    void preloadScene(key ? scene : null).catch(() => undefined)
  }

  async function push(): Promise<void> {
    if (!isTauri()) return
    const run = ++token
    const mode = options.mode.value
    const cueKey = options.cueKey.value
    const transition = options.transition.value
    const sends: Promise<void>[] = []
    const live = new Set<string>()
    let firstLive: Screen | null = null
    for (const screen of options.show.value.screens) {
      const label = outputLabel(screen)
      if (!label) continue
      live.add(screen.id)
      firstLive ??= screen
      const previous = memory.get(screen.id) ?? null
      const action = outputAction(previous, { label, mode, cueKey, transition, testPattern: screen.testPattern !== null })
      if (action === 'skip') continue
      const scene = options.scene(screen)
      memory.set(screen.id, { label, scene, cueKey, mode })
      sends.push(
        action === 'transition' && previous
          ? applyTransition(label, transitionPlan(previous.scene, scene, transition))
          : applyScene(label, scene),
      )
    }
    for (const id of [...memory.keys()]) if (!live.has(id)) memory.delete(id)
    if (mode === 'live' && firstLive && options.nextScene) preload(options.nextScene(firstLive))
    try {
      await Promise.all(sends)
      if (run === token) error.value = ''
    } catch (reason) {
      if (run === token) error.value = message(reason)
    }
  }

  /** Opens an output on every assigned display that has none yet. */
  async function openAll(): Promise<void> {
    const indexes = new Set(
      options.show.value.screens
        .filter((screen) => screen.enabled)
        .map((screen) => displayForScreen(screens.displays.value, screen)?.index)
        .filter((index): index is number => index !== undefined),
    )
    for (const index of indexes) {
      if (!screens.outputFor(index)) await screens.openDisplay(index)
    }
    error.value = screens.error.value
    await push()
  }

  async function closeAll(): Promise<void> {
    for (const output of [...screens.outputs.value]) await screens.closeDisplay(output.label)
  }

  watch(
    () => [
      options.show.value,
      options.mode.value,
      options.cueKey.value,
      options.version(),
      screens.outputs.value,
      screens.displays.value,
    ] as const,
    () => void push(),
    { deep: false },
  )

  return {
    error,
    push,
    openAll,
    closeAll,
    outputLabel,
    displays: screens.displays,
    outputs: screens.outputs,
    outputFor: screens.outputFor,
    ensureLoaded: screens.ensureLoaded,
  }
}
