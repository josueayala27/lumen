//! MIDI stream parsing, live command bindings and learn mode.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiPortInfo {
    pub index: usize,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputMode {
    Live,
    Black,
    Clear,
    Logo,
    Freeze,
}

/// Commands a controller can trigger. Timer commands carry no clock; the
/// desktop stamps `now` when it applies them to the live reducer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum ControlCommand {
    Next,
    Prev,
    NextItem,
    PrevItem,
    PreviewNext,
    PreviewPrev,
    Take,
    SetMode {
        mode: OutputMode,
    },
    TimerStart {
        #[serde(rename = "timerId")]
        timer_id: String,
    },
    TimerStop {
        #[serde(rename = "timerId")]
        timer_id: String,
    },
    TimerReset {
        #[serde(rename = "timerId")]
        timer_id: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum MidiMessage {
    NoteOff {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    NoteOn {
        channel: u8,
        note: u8,
        velocity: u8,
    },
    PolyPressure {
        channel: u8,
        note: u8,
        pressure: u8,
    },
    ControlChange {
        channel: u8,
        controller: u8,
        value: u8,
    },
    ProgramChange {
        channel: u8,
        program: u8,
    },
    PitchBend {
        channel: u8,
        value: u16,
    },
    SystemCommon {
        status: u8,
        data: Vec<u8>,
    },
    SysEx {
        data: Vec<u8>,
    },
}

/// Incremental parser for a raw MIDI byte stream. Handles running status,
/// SysEx framing and ignores realtime bytes.
#[derive(Debug, Default)]
pub struct MidiStreamParser {
    running: Option<u8>,
    data: Vec<u8>,
    sysex: Option<Vec<u8>>,
}

impl MidiStreamParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, byte: u8) -> Option<MidiMessage> {
        if byte >= 0xF8 {
            return None;
        }

        if let Some(buffer) = self.sysex.as_mut() {
            if byte == 0xF7 {
                let data = self.sysex.take().unwrap_or_default();
                return Some(MidiMessage::SysEx { data });
            }
            if byte < 0x80 {
                buffer.push(byte);
                return None;
            }
            self.sysex = None;
        }

        if byte == 0xF0 {
            self.sysex = Some(Vec::new());
            self.running = None;
            self.data.clear();
            return None;
        }

        if byte >= 0x80 {
            self.data.clear();
            self.running = match byte {
                0xF1..=0xF3 => Some(byte),
                status if status < 0xF0 => Some(status),
                _ => None,
            };
            return None;
        }

        let status = self.running?;
        self.data.push(byte);
        if self.data.len() < data_length(status) {
            return None;
        }
        let data = std::mem::take(&mut self.data);
        if status >= 0xF0 {
            self.running = None;
        }
        build_message(status, &data)
    }
}

fn data_length(status: u8) -> usize {
    match status & 0xF0 {
        0xC0 | 0xD0 => 1,
        0xF0 => match status {
            0xF1 | 0xF3 => 1,
            0xF2 => 2,
            _ => 0,
        },
        _ => 2,
    }
}

fn build_message(status: u8, data: &[u8]) -> Option<MidiMessage> {
    let channel = status & 0x0F;
    let first = *data.first()?;
    let second = data.get(1).copied().unwrap_or(0);
    match status & 0xF0 {
        0x80 => Some(MidiMessage::NoteOff {
            channel,
            note: first,
            velocity: second,
        }),
        0x90 => Some(MidiMessage::NoteOn {
            channel,
            note: first,
            velocity: second,
        }),
        0xA0 => Some(MidiMessage::PolyPressure {
            channel,
            note: first,
            pressure: second,
        }),
        0xB0 => Some(MidiMessage::ControlChange {
            channel,
            controller: first,
            value: second,
        }),
        0xC0 => Some(MidiMessage::ProgramChange {
            channel,
            program: first,
        }),
        0xD0 => None,
        0xE0 => Some(MidiMessage::PitchBend {
            channel,
            value: u16::from(first) | (u16::from(second) << 7),
        }),
        0xF0 => Some(MidiMessage::SystemCommon {
            status,
            data: data.to_vec(),
        }),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MidiBindingKind {
    Note,
    ControlChange,
    ProgramChange,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MidiBinding {
    pub id: String,
    pub kind: MidiBindingKind,
    pub channel: Option<u8>,
    pub number: u8,
    pub command: ControlCommand,
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone)]
pub struct LearnRequest {
    id: String,
    command: ControlCommand,
    label: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Routed {
    Command {
        command: ControlCommand,
        binding_id: String,
    },
    Learned(MidiBinding),
    Ignored,
}

/// Maps controller messages to live commands and captures one binding while
/// learn mode is active.
#[derive(Debug, Default)]
pub struct MidiRouter {
    bindings: Vec<MidiBinding>,
    learn: Option<LearnRequest>,
    next_learn_id: u64,
}

impl MidiRouter {
    pub fn new(bindings: Vec<MidiBinding>) -> Self {
        Self {
            bindings,
            learn: None,
            next_learn_id: 1,
        }
    }

    pub fn bindings(&self) -> &[MidiBinding] {
        &self.bindings
    }

    pub fn set_bindings(&mut self, bindings: Vec<MidiBinding>) {
        self.bindings = bindings;
    }

    pub fn begin_learn(&mut self, command: ControlCommand, label: impl Into<String>) -> String {
        let id = format!("midi-learn-{}", self.next_learn_id);
        self.next_learn_id += 1;
        self.learn = Some(LearnRequest {
            id: id.clone(),
            command,
            label: label.into(),
        });
        id
    }

    pub fn cancel_learn(&mut self) {
        self.learn = None;
    }

    pub fn is_learning(&self) -> bool {
        self.learn.is_some()
    }

    pub fn route(&mut self, message: &MidiMessage) -> Routed {
        let Some((kind, channel, number)) = trigger(message) else {
            return Routed::Ignored;
        };

        if let Some(request) = self.learn.take() {
            let binding = MidiBinding {
                id: request.id,
                kind,
                channel: Some(channel),
                number,
                command: request.command,
                label: request.label,
            };
            self.bindings.push(binding.clone());
            return Routed::Learned(binding);
        }

        self.bindings
            .iter()
            .find(|binding| {
                binding.kind == kind
                    && binding.number == number
                    && binding.channel.is_none_or(|bound| bound == channel)
            })
            .map(|binding| Routed::Command {
                command: binding.command.clone(),
                binding_id: binding.id.clone(),
            })
            .unwrap_or(Routed::Ignored)
    }
}

fn trigger(message: &MidiMessage) -> Option<(MidiBindingKind, u8, u8)> {
    match message {
        MidiMessage::NoteOn {
            channel,
            note,
            velocity,
        } if *velocity > 0 => Some((MidiBindingKind::Note, *channel, *note)),
        MidiMessage::ControlChange {
            channel,
            controller,
            ..
        } => Some((MidiBindingKind::ControlChange, *channel, *controller)),
        MidiMessage::ProgramChange { channel, program } => {
            Some((MidiBindingKind::ProgramChange, *channel, *program))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_running_status() {
        let mut parser = MidiStreamParser::new();
        assert_eq!(parser.push(0x90), None);
        assert_eq!(parser.push(60), None, "first note waits for velocity");
        assert_eq!(
            parser.push(100),
            Some(MidiMessage::NoteOn {
                channel: 0,
                note: 60,
                velocity: 100
            })
        );
        assert_eq!(parser.push(62), None, "running status starts the next note");
        assert_eq!(
            parser.push(101),
            Some(MidiMessage::NoteOn {
                channel: 0,
                note: 62,
                velocity: 101
            })
        );
    }

    #[test]
    fn parses_sysex_and_ignores_realtime() {
        let mut parser = MidiStreamParser::new();
        for byte in [0xF0, 0x7F, 0xF8, 0x01, 0x01, 0xF7] {
            let message = parser.push(byte);
            if byte == 0xF7 {
                assert_eq!(
                    message,
                    Some(MidiMessage::SysEx {
                        data: vec![0x7F, 0x01, 0x01]
                    })
                );
            }
        }
    }

    #[test]
    fn routes_bound_control_change() {
        let binding = MidiBinding {
            id: "b1".into(),
            kind: MidiBindingKind::ControlChange,
            channel: Some(2),
            number: 64,
            command: ControlCommand::Next,
            label: "Pedal".into(),
        };
        let mut router = MidiRouter::new(vec![binding]);
        assert_eq!(
            router.route(&MidiMessage::ControlChange {
                channel: 2,
                controller: 64,
                value: 127
            }),
            Routed::Command {
                command: ControlCommand::Next,
                binding_id: "b1".into()
            }
        );
        assert_eq!(
            router.route(&MidiMessage::ControlChange {
                channel: 1,
                controller: 64,
                value: 127
            }),
            Routed::Ignored
        );
    }

    #[test]
    fn learns_next_note_and_keeps_it() {
        let mut router = MidiRouter::default();
        let id = router.begin_learn(ControlCommand::Take, "Take");
        let learned = router.route(&MidiMessage::NoteOn {
            channel: 9,
            note: 36,
            velocity: 127,
        });
        let Routed::Learned(binding) = learned else {
            panic!("expected learned binding");
        };
        assert_eq!(binding.id, id);
        assert_eq!(binding.kind, MidiBindingKind::Note);
        assert_eq!(binding.number, 36);
        assert_eq!(binding.command, ControlCommand::Take);

        assert_eq!(
            router.route(&MidiMessage::NoteOn {
                channel: 9,
                note: 36,
                velocity: 127
            }),
            Routed::Command {
                command: ControlCommand::Take,
                binding_id: id
            }
        );
    }

    #[test]
    fn note_off_does_not_fire() {
        let mut router = MidiRouter::new(vec![MidiBinding {
            id: "b1".into(),
            kind: MidiBindingKind::Note,
            channel: None,
            number: 60,
            command: ControlCommand::Prev,
            label: String::new(),
        }]);
        assert_eq!(
            router.route(&MidiMessage::NoteOff {
                channel: 0,
                note: 60,
                velocity: 0
            }),
            Routed::Ignored
        );
    }
}
