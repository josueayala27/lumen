import { computed, ref } from 'vue'
import {
  closeOutput,
  isTauri,
  listDisplays,
  listOutputs,
  openOutput,
  type DisplayInfo,
  type OutputWindow,
} from './api'
import {
  EMPTY_SETTINGS,
  isAssignedScreen,
  loadOutputSettings,
  resolveDisplay,
  saveOutputSettings,
  screenRef,
  type OutputSettings,
} from './screens'

const displays = ref<DisplayInfo[]>([])
const outputs = ref<OutputWindow[]>([])
const settings = ref<OutputSettings>({ ...EMPTY_SETTINGS })
const loading = ref(false)
const error = ref('')
let initialized = false

function message(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

async function refresh(): Promise<void> {
  if (!isTauri()) {
    initialized = true
    return
  }
  loading.value = true
  error.value = ''
  try {
    const [nextDisplays, nextOutputs] = await Promise.all([listDisplays(), listOutputs()])
    displays.value = nextDisplays
    outputs.value = nextOutputs
  } catch (reason) {
    error.value = message(reason)
  } finally {
    loading.value = false
    initialized = true
  }
}

async function ensureLoaded(): Promise<void> {
  if (initialized) return
  settings.value = await loadOutputSettings()
  await refresh()
}

async function assignAudience(display: DisplayInfo): Promise<void> {
  settings.value = { ...settings.value, audience: screenRef(display) }
  await saveOutputSettings(settings.value)
}

async function openDisplay(displayIndex: number): Promise<void> {
  error.value = ''
  try {
    await openOutput(displayIndex)
    await refresh()
  } catch (reason) {
    error.value = message(reason)
  }
}

async function closeDisplay(label: string): Promise<void> {
  error.value = ''
  try {
    await closeOutput(label)
    await refresh()
  } catch (reason) {
    error.value = message(reason)
  }
}

const audienceDisplay = computed(() => resolveDisplay(displays.value, settings.value.audience))
const audienceOutput = computed(() => {
  const display = audienceDisplay.value
  if (!display) return null
  return outputs.value.find((output) => output.display_index === display.index) ?? null
})
const audienceOnline = computed(() => audienceOutput.value !== null)

function outputFor(displayIndex: number): OutputWindow | null {
  return outputs.value.find((output) => output.display_index === displayIndex) ?? null
}

function isAudience(display: DisplayInfo): boolean {
  return audienceDisplay.value?.index === display.index
}

function matchesSavedScreen(display: DisplayInfo): boolean {
  return isAssignedScreen(display, settings.value.audience)
}

/** Opens the assigned screen, or closes it when it is already live. */
async function toggleAudience(): Promise<void> {
  const display = audienceDisplay.value
  if (!display) {
    await refresh()
    return
  }
  const output = audienceOutput.value
  if (output) {
    await closeDisplay(output.label)
    return
  }
  await openDisplay(display.index)
}

export function useOutputScreens() {
  return {
    displays,
    outputs,
    settings,
    loading,
    error,
    audienceDisplay,
    audienceOutput,
    audienceOnline,
    refresh,
    ensureLoaded,
    assignAudience,
    openDisplay,
    closeDisplay,
    toggleAudience,
    outputFor,
    isAudience,
    matchesSavedScreen,
  }
}
