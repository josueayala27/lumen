import { midiBindingSchema, type MidiBinding } from '@lumen/schema'

/** Tauri store file and key that hold learned MIDI bindings across launches. */
export const BINDINGS_FILE = 'settings.json'
export const BINDINGS_KEY = 'midiBindings'

function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

/** Keeps valid bindings, defaults the label and drops duplicate ids. */
export function normalizeBindings(value: unknown): MidiBinding[] {
  if (!Array.isArray(value)) return []
  const bindings: MidiBinding[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    const parsed = midiBindingSchema.safeParse(entry)
    if (!parsed.success || seen.has(parsed.data.id)) continue
    seen.add(parsed.data.id)
    bindings.push(parsed.data)
  }
  return bindings
}

/**
 * Backend bindings win: they are the live router state. Stored bindings are
 * only a restore source when the backend has none (fresh launch).
 */
export function mergeBindings(backend: MidiBinding[], stored: unknown): MidiBinding[] {
  if (backend.length > 0) return backend
  return normalizeBindings(stored)
}

/** Reads persisted bindings. Returns an empty list outside Tauri or on any store error. */
export async function loadBindings(): Promise<MidiBinding[]> {
  if (!isTauri()) return []
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(BINDINGS_FILE)
    return normalizeBindings(await store.get(BINDINGS_KEY))
  } catch {
    return []
  }
}

/** Writes bindings. Best-effort: never throws into the UI. */
export async function saveBindings(bindings: MidiBinding[]): Promise<void> {
  if (!isTauri()) return
  try {
    const { load } = await import('@tauri-apps/plugin-store')
    const store = await load(BINDINGS_FILE)
    await store.set(BINDINGS_KEY, normalizeBindings(bindings))
    await store.save()
  } catch {
    // Persistence is optional; the backend keeps bindings in memory for the session.
  }
}
