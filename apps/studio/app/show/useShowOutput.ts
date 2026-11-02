import type { Composition, OutputMode, Screen, ShowDoc, Transition } from '@lumen/schema'
import { ref, watch, type Ref } from 'vue'
import { compositionVideoKey } from '~/live/liveContent'
import { applyComposition, isTauri, preloadComposition } from '~/output/api'
import { useOutputScreens } from '~/output/useOutputScreens'
import { outputAction, outputTransition, screenForMode, statusErrors, type OutputMemory } from './showLive'
import { displayForScreen } from './showModel'

export interface ShowOutputOptions {
  show: Readonly<Ref<ShowDoc>>
  /** The composition on air right now (every screen shows it through its own layout). */
  composition: () => Composition
  /** The composition at the next rundown cue, for preloading its videos. */
  nextComposition?: () => Composition | null
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
 * Sends the program composition to the native outputs through the v2
 * compositor (`apply_composition`); Rust draws each screen's layout, mapping,
 * blackout and test pattern. Only screens whose display has an open output are
 * sent, so outputs open only through `openAll` or the Screens panel. Rundown
 * cue changes crossfade, freeze holds the last frame, `black`/`logo` black the
 * screen out, and the next cue's videos are preloaded paused.
 */
export function useShowOutput(options: ShowOutputOptions) {
  const screens = useOutputScreens()
  const error = ref('')
  /** Errors per screen id from the last send. */
  const screenErrors = ref<Record<string, string>>({})
  const memory = new Map<string, OutputMemory>()
  let preloadKey = ''
  let token = 0

  /** The open output a screen's display has, enabled or not. */
  function openLabel(screen: Screen): string | null {
    const display = displayForScreen(screens.displays.value, screen)
    return display ? (screens.outputFor(display.index)?.label ?? null) : null
  }

  /** The output an enabled screen drives right now. */
  function outputLabel(screen: Screen): string | null {
    return screen.enabled ? openLabel(screen) : null
  }

  /**
   * Preloads the next cue's videos with `preload_composition`. Decoder demand
   * is shared by asset id, so a video preloaded here starts from its first
   * frame when `apply_composition` puts it on air. Sent only when the set of
   * videos changes.
   */
  function preload(composition: Composition | null): void {
    const key = composition ? compositionVideoKey(composition) : ''
    if (key === preloadKey) return
    preloadKey = key
    void preloadComposition(key ? composition : null).catch(() => undefined)
  }

  async function push(): Promise<void> {
    if (!isTauri()) return
    const run = ++token
    const mode = options.mode.value
    const cueKey = options.cueKey.value
    const transition = options.transition.value
    const now = Date.now()
    const all = options.show.value.screens
    const enabledLabels = new Set(all.flatMap((screen) => (screen.enabled ? [openLabel(screen) ?? ''] : [])))
    const groups = new Map<string, { transition: Transition | null; screens: Screen[] }>()
    const live = new Set<string>()

    for (const screen of all) {
      const label = openLabel(screen)
      if (!label) continue
      // A disabled screen blacks out its output only when no enabled screen uses it.
      if (!screen.enabled && enabledLabels.has(label)) continue
      live.add(screen.id)
      const previous = memory.get(screen.id) ?? null
      const action = outputAction(previous, { label, mode, cueKey, transition, testPattern: screen.testPattern !== null })
      if (action === 'skip') continue
      const sent = outputTransition(previous, action, { cueKey, transition }, now)
      memory.set(screen.id, {
        label,
        cueKey,
        mode,
        transition: action === 'transition' ? transition : sent,
        transitionEndsAt: action === 'transition' ? now + transition.durationMs : (previous?.transitionEndsAt ?? 0),
      })
      const key = sent ? JSON.stringify(sent) : 'cut'
      const group = groups.get(key) ?? { transition: sent, screens: [] }
      group.screens.push(screenForMode(screen, mode))
      groups.set(key, group)
    }
    for (const id of [...memory.keys()]) if (!live.has(id)) memory.delete(id)
    if (mode === 'live' && options.nextComposition) preload(options.nextComposition())
    if (groups.size === 0) return

    const composition = options.composition()
    try {
      const results = await Promise.all(
        [...groups.values()].map((group) => applyComposition(composition, group.screens, group.transition)),
      )
      if (run !== token) return
      const statuses = results.flat()
      screenErrors.value = Object.fromEntries(statuses.flatMap((status) => (status.error ? [[status.screenId, status.error]] : [])))
      error.value = statusErrors(statuses, all).join(' · ')
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
    screenErrors,
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
