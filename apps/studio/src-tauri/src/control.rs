use lumen_control::{
    ControlCommand, ControlCore, EventSink, FrameRate, LtcService, MidiBinding, MidiPortInfo,
    MidiService, TimecodeSnapshot,
};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

pub const CONTROL_EVENT: &str = "control:event";

pub struct ControlState {
    core: ControlCore,
    midi: Mutex<Option<MidiService>>,
    ltc: Mutex<Option<LtcService>>,
}

impl ControlState {
    pub fn new(app: AppHandle) -> Self {
        let sink: EventSink = Arc::new(move |event| {
            let _ = app.emit(CONTROL_EVENT, event);
        });
        Self {
            core: ControlCore::new(sink),
            midi: Mutex::new(None),
            ltc: Mutex::new(None),
        }
    }
}

#[tauri::command]
pub fn list_midi_inputs() -> Result<Vec<MidiPortInfo>, String> {
    lumen_control::input_ports()
}

#[tauri::command]
pub fn start_midi_input(state: State<'_, ControlState>, port: String) -> Result<(), String> {
    let mut slot = state.midi.lock().map_err(|_| "control state poisoned")?;
    if slot.is_some() {
        return Err("a MIDI input is already open".into());
    }
    *slot = Some(MidiService::start(state.core.clone(), &port)?);
    Ok(())
}

#[tauri::command]
pub fn stop_midi_input(state: State<'_, ControlState>) -> Result<(), String> {
    let mut slot = state.midi.lock().map_err(|_| "control state poisoned")?;
    *slot = None;
    Ok(())
}

#[tauri::command]
pub fn get_midi_bindings(state: State<'_, ControlState>) -> Result<Vec<MidiBinding>, String> {
    Ok(state
        .core
        .router
        .lock()
        .map_err(|_| "control state poisoned")?
        .bindings()
        .to_vec())
}

#[tauri::command]
pub fn set_midi_bindings(
    state: State<'_, ControlState>,
    bindings: Vec<MidiBinding>,
) -> Result<(), String> {
    state
        .core
        .router
        .lock()
        .map_err(|_| "control state poisoned")?
        .set_bindings(bindings);
    Ok(())
}

/// Captures the next MIDI note, CC or program change for `command`.
#[tauri::command]
pub fn begin_midi_learn(
    state: State<'_, ControlState>,
    command: ControlCommand,
    label: Option<String>,
) -> Result<String, String> {
    Ok(state
        .core
        .router
        .lock()
        .map_err(|_| "control state poisoned")?
        .begin_learn(command, label.unwrap_or_default()))
}

#[tauri::command]
pub fn cancel_midi_learn(state: State<'_, ControlState>) -> Result<(), String> {
    state
        .core
        .router
        .lock()
        .map_err(|_| "control state poisoned")?
        .cancel_learn();
    Ok(())
}

#[tauri::command]
pub fn list_audio_inputs() -> Vec<String> {
    lumen_control::audio_inputs()
}

#[tauri::command]
pub fn start_ltc_input(
    state: State<'_, ControlState>,
    device: Option<String>,
    rate: FrameRate,
    channel: Option<usize>,
) -> Result<(), String> {
    let mut slot = state.ltc.lock().map_err(|_| "control state poisoned")?;
    if slot.as_ref().is_some_and(LtcService::is_alive) {
        return Err("an LTC input is already open".into());
    }
    // A dead stream keeps the slot occupied until stopped. Drop it so the
    // user can restart without an extra command.
    *slot = None;
    *slot = Some(LtcService::start(
        state.core.clone(),
        device,
        rate,
        channel.unwrap_or(0),
    )?);
    Ok(())
}

#[tauri::command]
pub fn stop_ltc_input(state: State<'_, ControlState>) -> Result<(), String> {
    let mut slot = state.ltc.lock().map_err(|_| "control state poisoned")?;
    *slot = None;
    Ok(())
}

#[tauri::command]
pub fn timecode_state(state: State<'_, ControlState>) -> TimecodeSnapshot {
    state.core.timecode_snapshot()
}
