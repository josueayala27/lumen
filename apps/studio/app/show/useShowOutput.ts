import type { Theme } from '@lumen/schema'
import { ref, watch, type Ref } from 'vue'
import { sceneRevision, type MediaAssetLike } from '~/live/liveScene'
import { applyScene, isTauri } from '~/output/api'
import { useOutputScreens } from '~/output/useOutputScreens'
import { composeScreenScene, type ShowDoc, type ShowLive } from './showModel'

export interface ShowOutputOptions {
  show: Ref<ShowDoc>
  live: Ref<ShowLive>
  media: Ref<MediaAssetLike[]>
  theme: Ref<Theme | null>
  presentation: (id: string) => ReturnType<NonNullable<Parameters<typeof composeScreenScene>[3]['presentation']>>
  /** Bumps when a lyrics document finishes loading. */
  docsVersion: Ref<number>
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Sends each show screen its own scene on the native output open on its
 * display. Screens without a display, or whose display has no open output,
 * are skipped.
 */
export function useShowOutput(options: ShowOutputOptions) {
  const screens = useOutputScreens()
  const error = ref('')
  let token = 0

  async function push(): Promise<void> {
    if (!isTauri()) return
    const run = ++token
    const context = {
      media: options.media.value,
      presentation: options.presentation,
      theme: options.theme.value,
      revision: sceneRevision(),
    }
    const sends = options.show.value.screens.flatMap((screen) => {
      if (screen.displayIndex === null) return []
      const output = screens.outputFor(screen.displayIndex)
      if (!output) return []
      return [applyScene(output.label, composeScreenScene(options.show.value, options.live.value, screen, context))]
    })
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
        .map((screen) => screen.displayIndex)
        .filter((index): index is number => index !== null),
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
      options.live.value,
      options.media.value,
      options.theme.value,
      options.docsVersion.value,
      screens.outputs.value,
    ] as const,
    () => void push(),
    { deep: false },
  )

  return { error, push, openAll, closeAll, displays: screens.displays, outputs: screens.outputs, outputFor: screens.outputFor, ensureLoaded: screens.ensureLoaded }
}
