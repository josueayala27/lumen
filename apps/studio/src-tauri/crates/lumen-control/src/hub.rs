//! Device services: MIDI input, MTC over MIDI and LTC over audio input.

use crate::ltc::{channel_sample, LtcSampleDecoder};
use crate::midi::{
    ControlCommand, MidiBinding, MidiMessage, MidiPortInfo, MidiRouter, MidiStreamParser, Routed,
};
use crate::mtc::MtcDecoder;
use crate::timecode::{FrameRate, TimecodeSnapshot, TimecodeSource, TimecodeSync};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{FromSample, Sample, SampleFormat, SizedSample, StreamConfig};
use midir::{MidiInput, MidiInputConnection};
use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Instant;

pub type EventSink = Arc<dyn Fn(ControlEvent) + Send + Sync>;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ControlSource {
    Midi,
    Ltc,
    Mtc,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ControlEvent {
    Command {
        command: ControlCommand,
        source: ControlSource,
        #[serde(rename = "bindingId")]
        binding_id: Option<String>,
    },
    Learned {
        binding: MidiBinding,
    },
    Message {
        message: MidiMessage,
    },
    Timecode {
        snapshot: TimecodeSnapshot,
    },
    Error {
        message: String,
    },
}

/// Shared state for the Tauri layer and the device callback threads.
#[derive(Clone)]
pub struct ControlCore {
    pub router: Arc<Mutex<MidiRouter>>,
    pub sync: Arc<Mutex<TimecodeSync>>,
    sink: EventSink,
    started: Instant,
}

impl ControlCore {
    pub fn new(sink: EventSink) -> Self {
        Self {
            router: Arc::new(Mutex::new(MidiRouter::default())),
            sync: Arc::new(Mutex::new(TimecodeSync::default())),
            sink,
            started: Instant::now(),
        }
    }

    pub fn emit(&self, event: ControlEvent) {
        (self.sink)(event);
    }

    pub fn now_ms(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }

    pub fn snapshot(&self) -> TimecodeSnapshot {
        self.sync.lock().unwrap().snapshot(self.now_ms())
    }

    pub fn timecode_snapshot(&self) -> TimecodeSnapshot {
        self.snapshot()
    }
}

/// Lists the MIDI input ports available right now.
pub fn input_ports() -> Result<Vec<MidiPortInfo>, String> {
    let input = MidiInput::new("Lumen").map_err(|error| error.to_string())?;
    let ports = input.ports();
    Ok(ports
        .iter()
        .enumerate()
        .map(|(index, port)| MidiPortInfo {
            index,
            name: input
                .port_name(port)
                .unwrap_or_else(|_| format!("MIDI {}", index + 1)),
        })
        .collect())
}

/// Opens a MIDI input by port name or index. The connection lives on its own
/// thread and closes when the returned service is dropped.
pub struct MidiService {
    stop: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
}

impl MidiService {
    pub fn start(core: ControlCore, port_name: &str) -> Result<Self, String> {
        let input = MidiInput::new("Lumen").map_err(|error| error.to_string())?;
        let ports = input.ports();
        let port = ports
            .iter()
            .find(|port| input.port_name(port).is_ok_and(|name| name == port_name))
            .or_else(|| {
                port_name
                    .parse::<usize>()
                    .ok()
                    .and_then(|index| ports.get(index))
            })
            .ok_or_else(|| format!("MIDI input {port_name} is not connected"))?;

        let router = core.router.clone();
        let timecode = core.sync.clone();
        let event_core = core.clone();
        let mut parser = MidiStreamParser::new();
        let mut mtc = MtcDecoder::new();
        let connection: MidiInputConnection<()> = input
            .connect(
                port,
                "lumen-midi",
                move |_timestamp, bytes, _| {
                    for byte in bytes {
                        let Some(message) = parser.push(*byte) else {
                            continue;
                        };
                        event_core.emit(ControlEvent::Message {
                            message: message.clone(),
                        });
                        let routed = router.lock().unwrap().route(&message);
                        match routed {
                            Routed::Command {
                                command,
                                binding_id,
                            } => event_core.emit(ControlEvent::Command {
                                command,
                                source: ControlSource::Midi,
                                binding_id: Some(binding_id),
                            }),
                            Routed::Learned(binding) => {
                                event_core.emit(ControlEvent::Learned { binding });
                            }
                            Routed::Ignored => {}
                        }
                        if let Some(frame) = mtc.push(&message) {
                            timecode.lock().unwrap().update(
                                frame,
                                event_core.now_ms(),
                                TimecodeSource::Mtc,
                            );
                            event_core.emit(ControlEvent::Timecode {
                                snapshot: event_core.snapshot(),
                            });
                        }
                    }
                },
                (),
            )
            .map_err(|error| error.to_string())?;

        let (stop, stopped) = mpsc::channel();
        let thread = thread::spawn(move || {
            let _connection = connection;
            let _ = stopped.recv();
        });

        Ok(Self {
            stop,
            thread: Some(thread),
        })
    }
}

impl Drop for MidiService {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Lists audio input devices usable for LTC.
pub fn audio_inputs() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices()
        .map(|devices| devices.map(|device| device.to_string()).collect())
        .unwrap_or_default()
}

/// Captures LTC from an audio input on its own thread.
pub struct LtcService {
    stop: mpsc::Sender<()>,
    thread: Option<JoinHandle<()>>,
    failed: Arc<AtomicBool>,
}

impl LtcService {
    pub fn start(
        core: ControlCore,
        device_name: Option<String>,
        rate: FrameRate,
        channel: usize,
    ) -> Result<Self, String> {
        let failed = Arc::new(AtomicBool::new(false));
        let (started_tx, started_rx) = mpsc::channel::<Result<(), String>>();
        let (stop, stopped) = mpsc::channel();
        let thread_failed = failed.clone();
        let thread = thread::spawn(move || {
            match build_stream(&core, device_name.as_deref(), rate, channel, thread_failed) {
                Ok(stream) => {
                    if let Err(error) = stream.play() {
                        let _ = started_tx.send(Err(format!("LTC stream: {error}")));
                        return;
                    }
                    let _ = started_tx.send(Ok(()));
                    let _ = stopped.recv();
                    drop(stream);
                }
                Err(error) => {
                    let _ = started_tx.send(Err(error));
                }
            }
        });

        match started_rx.recv() {
            Ok(Ok(())) => Ok(Self {
                stop,
                thread: Some(thread),
                failed,
            }),
            Ok(Err(error)) => {
                let _ = stop.send(());
                let _ = thread.join();
                Err(error)
            }
            Err(_) => {
                let _ = stop.send(());
                let _ = thread.join();
                Err("LTC audio thread stopped before opening the device".into())
            }
        }
    }

    /// Reports whether the stream is still running. A stream error marks the
    /// service as dead so the caller can open a fresh one without an explicit
    /// stop first.
    pub fn is_alive(&self) -> bool {
        !self.failed.load(Ordering::Relaxed)
            && self.thread.as_ref().is_some_and(|thread| !thread.is_finished())
    }
}

impl Drop for LtcService {
    fn drop(&mut self) {
        let _ = self.stop.send(());
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

fn build_stream(
    core: &ControlCore,
    device_name: Option<&str>,
    rate: FrameRate,
) -> Result<cpal::Stream, String> {
    let host = cpal::default_host();
    let device = match device_name {
        Some(wanted) => host
            .input_devices()
            .map_err(|error| error.to_string())?
            .find(|device| device.to_string() == wanted)
            .ok_or_else(|| format!("audio input {wanted} is not connected"))?,
        None => host
            .default_input_device()
            .ok_or_else(|| "no audio input device".to_string())?,
    };
    let supported = device
        .default_input_config()
        .map_err(|error| error.to_string())?;
    let sample_format = supported.sample_format();
    let config: StreamConfig = supported.into();
    let channels = usize::from(config.channels);
    let sample_rate = f64::from(config.sample_rate);
    match sample_format {
        SampleFormat::F32 => build_typed::<f32>(&device, config, channels, sample_rate, rate, core),
        SampleFormat::I16 => build_typed::<i16>(&device, config, channels, sample_rate, rate, core),
        SampleFormat::I32 => build_typed::<i32>(&device, config, channels, sample_rate, rate, core),
        other => Err(format!("unsupported LTC input sample format {other}")),
    }
}

fn build_typed<T>(
    device: &cpal::Device,
    config: StreamConfig,
    channels: usize,
    sample_rate: f64,
    rate: FrameRate,
    core: &ControlCore,
) -> Result<cpal::Stream, String>
where
    T: SizedSample + 'static,
    f32: FromSample<T>,
{
    let mut decoder = LtcSampleDecoder::new(sample_rate, rate);
    let events = core.clone();
    let errors = core.clone();
    device
        .build_input_stream(
            config,
            move |data: &[T], _: &cpal::InputCallbackInfo| {
                for frame in data.chunks(channels.max(1)) {
                    let Some(sample) = frame.first() else {
                        continue;
                    };
                    let sample: f32 = f32::from_sample(*sample);
                    if let Some(timecode) = decoder.push_sample(sample) {
                        let now = events.now_ms();
                        events
                            .sync
                            .lock()
                            .unwrap()
                            .update(timecode, now, TimecodeSource::Ltc);
                        events.emit(ControlEvent::Timecode {
                            snapshot: events.snapshot(),
                        });
                    }
                }
            },
            move |error| {
                errors.emit(ControlEvent::Error {
                    message: format!("LTC audio: {error}"),
                })
            },
            None,
        )
        .map_err(|error| error.to_string())
}
