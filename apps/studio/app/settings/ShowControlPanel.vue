<script setup lang="ts">
import { css } from 'styled-system/css'
import { Badge, Button, IconButton, Panel, PanelSection, Select } from '~/ui'
import { useShowControl } from '~/control/useShowControl'
import {
  beginMidiLearn,
  getMidiBindings,
  listAudioInputs,
  listMidiInputs,
  setMidiBindings,
  startLtcInput,
  startMidiInput,
  stopLtcInput,
  stopMidiInput,
} from '~/control/api'
import { loadBindings, mergeBindings, saveBindings } from '~/control/bindings'
import type { ControlCommand, FrameRate, MidiBinding } from '@lumen/schema'
import { computed, onMounted, ref, watch } from 'vue'

const port = ref<string>()
const ports = ref<{ value: string; label: string }[]>([])
const audioDevice = ref<string>()
const audioDevices = ref<{ value: string; label: string }[]>([])
const rate = ref<FrameRate>('29.97df')
const bindings = ref<MidiBinding[]>([])
const learning = ref('')
const error = ref('')
const midiOpen = ref(false)
const ltcOpen = ref(false)

const { timecode, learned } = useShowControl(() => {})

const rateOptions: { value: FrameRate; label: string }[] = [
  { value: '23.976', label: '23.976' },
  { value: '24', label: '24' },
  { value: '25', label: '25' },
  { value: '29.97', label: '29.97' },
  { value: '29.97df', label: '29.97 drop-frame' },
  { value: '30', label: '30' },
]

const actions: { label: string; command: ControlCommand }[] = [
  { label: 'Next', command: { type: 'next' } },
  { label: 'Previous', command: { type: 'prev' } },
  { label: 'Take', command: { type: 'take' } },
  { label: 'Black', command: { type: 'setMode', mode: 'black' } },
  { label: 'Clear', command: { type: 'setMode', mode: 'clear' } },
  { label: 'Logo', command: { type: 'setMode', mode: 'logo' } },
  { label: 'Freeze', command: { type: 'setMode', mode: 'freeze' } },
]

const timecodeLabel = computed(() => {
  const value = timecode.value?.timecode
  if (!value) return 'No timecode'
  const pad = (number: number) => String(number).padStart(2, '0')
  const separator = value.rate === '29.97df' ? ';' : ':'
  return `${pad(value.hours)}:${pad(value.minutes)}:${pad(value.seconds)}${separator}${pad(value.frames)}`
})

const timecodeTone = computed(() => (timecode.value?.locked ? 'success' : 'neutral'))

async function run(label: string, action: () => Promise<unknown>): Promise<void> {
  error.value = ''
  try {
    await action()
    return
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
  learning.value = ''
  if (label) error.value = `${label}: ${error.value}`
}

onMounted(async () => {
  await run('Devices', async () => {
    const [midi, audio, saved] = await Promise.all([listMidiInputs(), listAudioInputs(), getMidiBindings()])
    ports.value = midi.map((entry) => ({ value: entry.name, label: entry.name }))
    audioDevices.value = audio.map((name) => ({ value: name, label: name }))
    let restored = saved
    if (saved.length === 0) {
      restored = mergeBindings(saved, await loadBindings())
      if (restored.length > 0) await setMidiBindings(restored)
    }
    bindings.value = restored
  })
})

watch(learned, async (binding) => {
  if (!binding) return
  learning.value = ''
  try {
    bindings.value = await getMidiBindings()
    await saveBindings(bindings.value)
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason)
  }
})

async function connectMidi(): Promise<void> {
  if (!port.value) return
  await run('MIDI', async () => {
    await startMidiInput(port.value!)
    midiOpen.value = true
  })
}

async function disconnectMidi(): Promise<void> {
  await run('MIDI', async () => {
    await stopMidiInput()
    midiOpen.value = false
  })
}

async function connectLtc(): Promise<void> {
  await run('LTC', async () => {
    await startLtcInput(audioDevice.value ?? null, rate.value)
    ltcOpen.value = true
  })
}

async function disconnectLtc(): Promise<void> {
  await run('LTC', async () => {
    await stopLtcInput()
    ltcOpen.value = false
  })
}

async function learn(label: string, command: ControlCommand): Promise<void> {
  await run('Learn', async () => {
    await beginMidiLearn(command, label)
    learning.value = label
  })
}

async function remove(binding: MidiBinding): Promise<void> {
  const next = bindings.value.filter((entry) => entry.id !== binding.id)
  await run('Bindings', async () => {
    await setMidiBindings(next)
    bindings.value = next
    await saveBindings(next)
  })
}

function describeCommand(command: ControlCommand): string {
  return command.type === 'setMode' ? `setMode ${command.mode}` : command.type
}

function describe(binding: MidiBinding): string {
  const channel = binding.channel === null ? 'any' : `ch ${binding.channel + 1}`
  return `${binding.kind} ${binding.number} · ${channel}`
}

const page = css({ h: 'auto', p: '0' })
const panel = css({ maxW: '[720px]', h: 'auto' })
const field = css({ display: 'flex', flexDirection: 'column', gap: '1.5', mb: '4' })
const label = css({ textStyle: 'ui.sm', color: 'fg.muted' })
const row = css({ display: 'flex', alignItems: 'center', gap: '2' })
const actionsRow = css({ display: 'flex', flexWrap: 'wrap', gap: '2' })
const binding = css({ display: 'flex', alignItems: 'center', gap: '2', py: '2', borderBottomWidth: '1px', borderColor: 'border.default', _last: { borderBottomWidth: '0' } })
const bindingMeta = css({ flex: '1', minW: '0' })
const bindingTitle = css({ textStyle: 'ui.sm', color: 'fg.default' })
const bindingNote = css({ textStyle: 'ui.xs', color: 'fg.subtle' })
const status = css({ display: 'flex', alignItems: 'center', gap: '2' })
const failure = css({ mt: '3', textStyle: 'ui.xs', color: 'danger.default' })
</script>

<template>
  <div :class="page">
    <Panel title="Show control" bordered="all" :class="panel">
      <PanelSection title="Timecode">
        <div :class="status">
          <span :class="css({ textStyle: 'ui.mono', fontSize: '[20px]', color: 'fg.default' })">{{ timecodeLabel }}</span>
          <Badge :tone="timecodeTone" dot :label="timecode?.locked ? (timecode.source?.toUpperCase() ?? 'LOCKED') : 'NO LOCK'" />
        </div>
        <div :class="field">
          <span :class="label">LTC input</span>
          <div :class="row">
            <Select v-model="audioDevice" :options="audioDevices" placeholder="Default input" aria-label="LTC audio input" />
            <Select v-model="rate" :options="rateOptions" aria-label="Timecode frame rate" />
          </div>
          <div :class="row">
            <Button v-if="!ltcOpen" variant="secondary" size="sm" icon="lucide:audio-lines" @click="connectLtc">Follow LTC</Button>
            <Button v-else variant="ghost" size="sm" icon="lucide:square" @click="disconnectLtc">Stop LTC</Button>
          </div>
        </div>
      </PanelSection>

      <PanelSection title="MIDI input">
        <div :class="field">
          <div :class="row">
            <Select v-model="port" :options="ports" placeholder="Select a MIDI device" aria-label="MIDI input" />
            <Button v-if="!midiOpen" variant="secondary" size="sm" icon="lucide:plug" @click="connectMidi">Connect</Button>
            <Button v-else variant="ghost" size="sm" icon="lucide:unplug" @click="disconnectMidi">Disconnect</Button>
          </div>
        </div>
        <p :class="label">{{ learning ? `Listening for ${learning}…` : 'Learn a binding: choose an action, then press a pad, pedal or key.' }}</p>
        <div :class="actionsRow">
          <Button
            v-for="action in actions"
            :key="action.label"
            variant="ghost"
            size="sm"
            :disabled="Boolean(learning)"
            @click="learn(action.label, action.command)"
          >
            {{ action.label }}
          </Button>
        </div>
      </PanelSection>

      <PanelSection title="Bindings" flush>
        <div v-if="bindings.length === 0" :class="bindingNote">No MIDI bindings yet.</div>
        <div v-for="entry in bindings" :key="entry.id" :class="binding">
          <div :class="bindingMeta">
            <p :class="bindingTitle">{{ entry.label || describeCommand(entry.command) }}</p>
            <p :class="bindingNote">{{ describe(entry) }} · {{ describeCommand(entry.command) }}</p>
          </div>
          <IconButton icon="lucide:x" label="Remove binding" size="sm" @click="remove(entry)" />
        </div>
      </PanelSection>
    </Panel>
    <p v-if="error" :class="failure">{{ error }}</p>
  </div>
</template>
