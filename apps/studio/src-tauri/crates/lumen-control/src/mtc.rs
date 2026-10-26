//! MIDI Timecode (MTC) decoding: quarter-frame and full-frame messages.

use crate::midi::MidiMessage;
use crate::timecode::{FrameRate, Timecode};

/// Assembles the eight MTC quarter-frame messages into a timecode. A gap in
/// the piece sequence restarts assembly instead of mixing two frames.
#[derive(Debug, Default)]
pub struct MtcDecoder {
    quarters: [Option<u8>; 8],
    last_piece: Option<u8>,
}

impl MtcDecoder {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, message: &MidiMessage) -> Option<Timecode> {
        match message {
            MidiMessage::SystemCommon { status: 0xF1, data } => self.push_quarter(*data.first()?),
            MidiMessage::SysEx { data } => self.push_full_frame(data),
            _ => None,
        }
    }

    fn push_quarter(&mut self, byte: u8) -> Option<Timecode> {
        let piece = byte >> 4;
        if piece > 7 {
            return None;
        }
        let nibble = byte & 0x0F;
        let expected = self.last_piece.map(|last| (last + 1) % 8);
        if expected.is_some_and(|expected| expected != piece) {
            self.quarters = [None; 8];
        }
        self.last_piece = Some(piece);
        self.quarters[usize::from(piece)] = Some(nibble);

        if piece != 7 {
            return None;
        }
        let quarters = self.quarters;
        let value = |index: usize| -> Option<u8> { quarters[index] };
        let frame_units = value(0)?;
        let frame_tens = value(1)? & 0x03;
        let drop = value(1)? & 0x04 != 0;
        let seconds_units = value(2)?;
        let seconds_tens = value(3)? & 0x03;
        let minutes_units = value(4)?;
        let minutes_tens = value(5)? & 0x03;
        let hours_units = value(6)?;
        let hours_tens = value(7)? & 0x03;
        let rate = FrameRate::from_mtc_bits((value(7)? >> 2) & 0x03).with_drop_flag(drop);

        Timecode::new(
            hours_tens * 10 + hours_units,
            minutes_tens * 10 + minutes_units,
            seconds_tens * 10 + seconds_units,
            frame_tens * 10 + frame_units,
            rate,
        )
        .ok()
    }

    fn push_full_frame(&mut self, data: &[u8]) -> Option<Timecode> {
        if data.len() < 8 || data[0] != 0x7F || data[2] != 0x01 || data[3] != 0x01 {
            return None;
        }
        let hours_byte = data[4];
        let rate = FrameRate::from_mtc_bits((hours_byte >> 5) & 0x03);
        let hours = hours_byte & 0x1F;
        let timecode = Timecode::new(hours, data[5], data[6], data[7], rate).ok()?;
        self.quarters = [None; 8];
        self.last_piece = None;
        Some(timecode)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quarter(piece: u8, nibble: u8) -> MidiMessage {
        MidiMessage::SystemCommon {
            status: 0xF1,
            data: vec![(piece << 4) | (nibble & 0x0F)],
        }
    }

    #[test]
    fn assembles_quarter_frames() {
        let mut decoder = MtcDecoder::new();
        let pieces = [4, 0, 3, 0, 2, 0, 1, 0x04];
        let mut result = None;
        for (piece, nibble) in pieces.iter().enumerate() {
            result = decoder.push(&quarter(piece as u8, *nibble));
        }
        assert_eq!(
            result.map(|timecode| timecode.to_string()),
            Some("01:02:03:04".into())
        );
    }

    #[test]
    fn parses_full_frame_sysex() {
        let mut decoder = MtcDecoder::new();
        let message = MidiMessage::SysEx {
            data: vec![0x7F, 0x7F, 0x01, 0x01, 0x21, 2, 3, 4],
        };
        assert_eq!(
            decoder.push(&message).map(|timecode| timecode.to_string()),
            Some("01:02:03:04".into())
        );
    }

    #[test]
    fn gap_restarts_assembly() {
        let mut decoder = MtcDecoder::new();
        assert_eq!(decoder.push(&quarter(0, 4)), None);
        assert_eq!(decoder.push(&quarter(3, 0)), None);
        assert_eq!(decoder.push(&quarter(4, 2)), None);
        assert_eq!(decoder.push(&quarter(5, 0)), None);
        assert_eq!(decoder.push(&quarter(6, 1)), None);
        assert_eq!(decoder.push(&quarter(7, 0x04)), None, "missing pieces");
        assert_eq!(decoder.push(&quarter(0, 5)), None);
        assert_eq!(decoder.push(&quarter(1, 0)), None);
        assert_eq!(decoder.push(&quarter(2, 3)), None);
        assert_eq!(decoder.push(&quarter(3, 0)), None);
        assert_eq!(decoder.push(&quarter(4, 2)), None);
        assert_eq!(decoder.push(&quarter(5, 0)), None);
        assert_eq!(decoder.push(&quarter(6, 1)), None);
        assert_eq!(
            decoder
                .push(&quarter(7, 0x04))
                .map(|timecode| timecode.to_string()),
            Some("01:02:03:05".into())
        );
    }
}
