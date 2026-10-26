import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { controlEventSchema, type LiveCommand, type MidiBinding, type TimecodeSnapshot } from '@lumen/schema'
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { toLiveCommand } from './commands'

/** Applies controller commands to the live reducer and exposes timecode state. */
export function useShowControl(apply: (command: LiveCommand) => void) {
  const timecode = ref<TimecodeSnapshot | null>(null)
  const learned = ref<MidiBinding | null>(null)
  let unlisten: UnlistenFn | undefined

  onMounted(async () => {
    try {
      unlisten = await listen('control:event', (event) => {
        const parsed = controlEventSchema.safeParse(event.payload)
        if (!parsed.success) return
        const payload = parsed.data
        if (payload.type === 'command') {
          apply(toLiveCommand(payload.command))
        } else if (payload.type === 'timecode') {
          timecode.value = payload.snapshot
        } else if (payload.type === 'learned') {
          learned.value = payload.binding
        }
      })
    } catch {
      // Not running under Tauri; the web build has no control devices.
    }
  })

  onBeforeUnmount(() => {
    unlisten?.()
  })

  return { timecode, learned }
}
