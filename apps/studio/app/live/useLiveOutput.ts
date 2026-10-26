import type { LiveState, Scene, Theme } from '@lumen/schema'
import { computed, ref, watch, type Ref } from 'vue'
import { applyScene, applyTransition } from '~/output/api'
import {
  nextLivePosition,
  resolveLiveSlide,
  type LiveItem,
  type LiveSlide,
} from './liveSession'
import {
  effectiveTransition,
  isCut,
  modeScene,
  sceneForSlide,
  sceneRevision,
  transitionPlan,
  type MediaAssetLike,
  type SceneSlideSource,
} from './liveScene'

export interface LiveOutputOptions {
  state: Ref<LiveState>
  items: Ref<LiveItem[]>
  theme: Ref<Theme | null>
  media: Ref<MediaAssetLike[]>
  outputLabel: Ref<string | null>
  desktop: Ref<boolean>
  /** Per-frame overrides from the show timeline. A new `key` re-pushes the scene. */
  sceneTransform?: Ref<LiveSceneTransform | null>
}

export interface LiveSceneTransform {
  key: string
  apply: (scene: Scene, source: SceneSlideSource | null) => Scene
}

interface Position {
  item: LiveItem
  slideIndex: number
  slide: LiveSlide
}

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

/**
 * Pushes the live state to the native audience output. Scenes are rebuilt on
 * slide, item, take, mode, theme, media and output changes. Freeze sends nothing
 * once the output has the last frame, so the audience holds the rendered scene.
 */
export function useLiveOutput(options: LiveOutputOptions) {
  const error = ref('')
  const nextScene = ref<Scene | null>(null)
  const lastScene = ref<Scene | null>(null)
  const lastKey = ref('')
  let lastLabel: string | null = null
  let lastMode: LiveState['mode'] = 'live'
  let token = 0

  function position(): Position | null {
    const state = options.state.value
    const found = resolveLiveSlide(options.items.value, state.itemIndex, state.slideIndex)
    return found ? { item: found.item, slideIndex: state.slideIndex, slide: found.slide } : null
  }

  function nextPosition(): Position | null {
    const state = options.state.value
    return nextLivePosition(options.items.value, state.itemIndex, state.slideIndex)
  }

  function sourceOf(value: Position | null): SceneSlideSource | null {
    if (!value) return null
    return { doc: value.item.doc, slideIndex: value.slideIndex, label: value.slide.label }
  }

  const currentSource = computed(() => sourceOf(position()))

  function currentScene(revision = sceneRevision()): Scene {
    const source = currentSource.value ?? { doc: null, slideIndex: 0, label: 'No slide' }
    const scene = sceneForSlide(source, options.theme.value, options.media.value, revision)
    const transform = options.sceneTransform?.value
    return transform ? transform.apply(scene, currentSource.value) : scene
  }

  function transitionFor(value: Position | null): ReturnType<typeof effectiveTransition> {
    const doc = value?.item.doc ?? null
    const sourceSlide = doc && value ? doc.slides[value.slideIndex] ?? null : null
    return effectiveTransition(sourceSlide, options.theme.value)
  }

  async function push(): Promise<void> {
    const label = options.outputLabel.value
    if (!options.desktop.value || !label) {
      lastScene.value = null
      lastKey.value = ''
      lastLabel = null
      return
    }

    const outputChanged = label !== lastLabel
    if (outputChanged) {
      lastLabel = label
      lastScene.value = null
      lastKey.value = ''
    }

    const state = options.state.value
    const key = `${state.itemIndex}:${state.slideIndex}`
    const run = ++token
    const fail = (reason: unknown): void => {
      if (run === token) error.value = message(reason)
    }

    if (state.mode === 'freeze') {
      if (!outputChanged) return
      // A new output has no frame to hold, so seed it with the current scene.
      const scene = currentScene()
      try {
        await applyScene(label, scene)
      } catch (reason) {
        fail(reason)
        return
      }
      if (run !== token) return
      error.value = ''
      lastScene.value = scene
      lastKey.value = key
      lastMode = state.mode
      return
    }

    if (state.mode !== 'live') {
      const scene = modeScene(state.mode, sceneRevision())
      if (!scene) return
      try {
        await applyScene(label, scene)
      } catch (reason) {
        fail(reason)
        return
      }
      if (run !== token) return
      error.value = ''
      lastScene.value = scene
      lastKey.value = key
      lastMode = state.mode
      return
    }

    const previous = lastScene.value
    const transition = transitionFor(position())
    const scene = currentScene()
    const nextSource = sourceOf(nextPosition())
    nextScene.value = nextSource
      ? sceneForSlide(nextSource, options.theme.value, options.media.value, sceneRevision())
      : null
    const canTransition =
      previous !== null && lastKey.value !== key && lastMode === 'live' && !isCut(transition)

    try {
      if (canTransition) {
        await applyTransition(label, transitionPlan(previous, scene, transition))
      } else {
        await applyScene(label, scene)
      }
    } catch (reason) {
      fail(reason)
      return
    }
    if (run !== token) return
    error.value = ''
    lastScene.value = scene
    lastKey.value = key
    lastMode = 'live'
  }

  watch(
    () => [
      options.desktop.value,
      options.outputLabel.value,
      options.state.value.mode,
      options.state.value.itemIndex,
      options.state.value.slideIndex,
      options.items.value,
      options.theme.value,
      options.media.value,
      options.sceneTransform?.value?.key ?? '',
    ] as const,
    () => void push(),
  )

  return { error, nextScene, push }
}
