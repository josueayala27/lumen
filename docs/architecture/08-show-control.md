# 08 — Show control

External control lives in `apps/studio/src-tauri/crates/lumen-control`. The crate has no Tauri dependency; `src/control.rs` in the desktop crate wires it to commands and events.

## Scope

- MIDI input only. Notes, control changes and program changes trigger live commands. No MIDI output, no motor fader or LED feedback.
- SMPTE timecode follow. MTC arrives over the MIDI input; LTC arrives on an audio input. Lumen does not generate timecode or drive other devices.
- OSC stays out of scope until Phase 4.

## Timecode

`FrameRate` covers 23.976, 24, 25, 29.97, 29.97 drop-frame and 30. Drop-frame follows the standard two-frame drop every minute except every tenth minute; labels such as `00:01:00;00` are rejected.

`TimecodeSync` stores the last received frame and extrapolates with the real frame rate between updates. It reports `locked: false` after one second without a source. `snapshot()` never blocks the caller.

- MTC: quarter-frame pieces 0–7 are assembled only when the piece sequence has no gap. Full-frame SysEx (`F0 7F … 01 01`) resets the assembly.
- LTC: sign changes in the selected audio channel become biphase-mark intervals. A half interval followed by a half is a one; a full interval is a zero. The 80-bit window reports a frame when the `0x3FFD` sync word is present and the fields validate.
- LTC input selects one channel from interleaved frames (`channel`, default `0`). An out-of-range channel falls back to channel 0. A Schmitt trigger with a default amplitude threshold of `0.02` (about -34 dBFS) keeps silence and low-level noise from producing transitions; the threshold is clamped to `0.0..=1.0`.

## MIDI

`MidiStreamParser` handles running status and SysEx framing. Realtime bytes are ignored. `MidiRouter` matches a trigger against the first binding:

```
MidiBinding { id, kind: note | controlChange | programChange, channel: 0-15 | null, number, command, label }
```

`channel: null` matches any channel. Learn mode captures the next note, CC or program change and stores it with the command passed to `begin_learn`. The learned binding is emitted before it can fire, so the UI can persist it. The Settings page (`ShowControlPanel.vue`) lists devices, learns bindings and starts LTC. Bindings are in memory until the settings store lands.

## Commands

`list_midi_inputs`, `start_midi_input`, `stop_midi_input`, `get_midi_bindings`, `set_midi_bindings`, `begin_midi_learn`, `cancel_midi_learn`, `list_audio_inputs`, `start_ltc_input`, `stop_ltc_input`, `timecode_state`.

`start_ltc_input` takes `{ device: string | null, rate: FrameRate, channel?: number }`, where `channel` defaults to `0`; `start_midi_input` takes `{ port: string }` as a name or index.

## Events

One Tauri event, `control:event`, carries a tagged payload:

```
{ type: 'command', command, source: 'midi' | 'ltc' | 'mtc', bindingId }
{ type: 'learned', binding }
{ type: 'message', message }
{ type: 'timecode', snapshot: { timecode, locked, source } }
{ type: 'error', message }
```

`useShowControl` validates the payload with `controlEventSchema`, stamps timer commands with `Date.now()` and forwards the rest to `liveReducer`.

## Threads and teardown

The MIDI connection and the audio stream each own a thread. Dropping `MidiService` or `LtcService` stops the thread and closes the device. Audio callbacks take a mutex around the timecode state; they do no allocation beyond event dispatch.

A cpal stream error emits `ControlEvent::Error` with a message naming the failure and marks the LTC service dead. Lumen does not re-enumerate devices automatically: the user stops the dead input and starts it again, and `start_ltc_input` replaces a dead service without requiring `stop_ltc_input` first.
