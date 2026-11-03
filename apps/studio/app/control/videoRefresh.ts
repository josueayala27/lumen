import type { Composition } from '@lumen/schema'
import { onBeforeUnmount, watch, type WatchSource } from 'vue'

/**
 * Previews render on demand, so a playing video only reaches them on the next
 * document change. True when an enabled layer shows a video source: the
 * preview then has to keep rendering to pick up new frames.
 */
export function compositionHasVideo(composition: Composition | null | undefined): boolean {
  if (!composition) return false
  const videos = new Set(composition.sources.filter((source) => source.kind === 'video').map((source) => source.id))
  if (videos.size === 0) return false
  return composition.layers.some((layer) => layer.enabled && layer.sourceId !== null && videos.has(layer.sourceId))
}

/** Default refresh for preview monitors while video plays: 10 renders a second. */
export const VIDEO_REFRESH_MS = 100

/**
 * Calls `render` every `intervalMs` while `active` is true. `render` must
 * coalesce overlapping calls (the preview composables already do), so a slow
 * render never stacks up.
 */
export function useVideoRefresh(active: WatchSource<boolean>, render: () => unknown, intervalMs = VIDEO_REFRESH_MS): void {
  let timer: ReturnType<typeof setInterval> | null = null
  const stop = () => {
    if (timer) clearInterval(timer)
    timer = null
  }
  watch(
    active,
    (on) => {
      stop()
      if (on) timer = setInterval(() => void render(), Math.max(16, intervalMs))
    },
    { immediate: true },
  )
  onBeforeUnmount(stop)
}
