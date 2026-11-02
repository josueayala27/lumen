import type { Screen, ShowDoc } from '@lumen/schema'
import { watch, type Ref } from 'vue'
import type { MediaAsset } from '~/data/media'
import { applyScene, isTauri, type DisplayInfo } from '~/output/api'
import { useOutputScreens } from '~/output/useOutputScreens'
import { displayForScreen } from '~/show/showModel'
import { useShowLive } from '~/show/useShowLive'

/**
 * Native outputs seen from the Screens workspace: which monitor a screen
 * targets and whether its window is open. Shares state with the Show page
 * through `useOutputScreens`.
 */
export function useScreenOutputs() {
  const screens = useOutputScreens()

  function displayFor(screen: Screen): DisplayInfo | null {
    return displayForScreen(screens.displays.value, screen)
  }

  function outputForScreen(screen: Screen) {
    const display = displayFor(screen)
    return display ? (screens.outputFor(display.index) ?? null) : null
  }

  async function open(screen: Screen): Promise<void> {
    const display = displayFor(screen)
    if (display && !screens.outputFor(display.index)) await screens.openDisplay(display.index)
  }

  async function close(screen: Screen): Promise<void> {
    const output = outputForScreen(screen)
    if (output) await screens.closeDisplay(output.label)
  }

  return {
    displays: screens.displays,
    outputs: screens.outputs,
    loading: screens.loading,
    error: screens.error,
    refresh: screens.refresh,
    ensureLoaded: screens.ensureLoaded,
    outputFor: screens.outputFor,
    displayFor,
    outputForScreen,
    open,
    close,
  }
}

/**
 * The test pattern each screen shows on which output, keyed by screen id.
 * Screens without a pattern or without an open output are left out, so a
 * change of key means the output needs a new scene.
 */
export function testPatternKeys(screens: readonly Screen[], outputLabel: (screen: Screen) => string | null): Map<string, string> {
  const keys = new Map<string, string>()
  for (const screen of screens) {
    const label = outputLabel(screen)
    if (screen.enabled && screen.testPattern && label) keys.set(screen.id, `${label}:${screen.testPattern}:${screen.name}`)
  }
  return keys
}

/**
 * Shows identify and test patterns on the physical outputs while the Screens
 * workspace is open. When a pattern turns off, the screen gets what is on
 * air back (clips, rundown content and output mode from the shared live state).
 */
export function useTestPatternOutputs(show: Readonly<Ref<ShowDoc>>, media: Readonly<Ref<MediaAsset[]>>) {
  const outputs = useScreenOutputs()
  const live = useShowLive()
  let previous = new Map<string, string>()

  async function push(screen: Screen): Promise<void> {
    const output = outputs.outputForScreen(screen)
    if (!output) return
    const scene = live.screenScene(screen, 'program', show.value, {
      media: media.value.length ? media.value : live.session.media.value,
    })
    await applyScene(output.label, scene)
  }

  watch(
    () => [show.value.screens, outputs.outputs.value, outputs.displays.value] as const,
    ([screens]) => {
      if (!isTauri()) return
      const next = testPatternKeys(screens, (screen) => outputs.outputForScreen(screen)?.label ?? null)
      const changed = screens.filter((screen) => next.get(screen.id) !== previous.get(screen.id))
      previous = next
      for (const screen of changed) void push(screen).catch(() => undefined)
    },
    { immediate: true },
  )
}
