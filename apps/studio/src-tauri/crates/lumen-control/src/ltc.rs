//! Linear Timecode (LTC) decoding.
//!
//! LTC is an 80-bit biphase-mark signal carried on an audio channel. The
//! decoder converts sign changes into bit-cell intervals, assembles 80-bit
//! frames and validates the 0x3FFD sync word before reporting a timecode.

use crate::timecode::{FrameRate, Timecode};
use std::collections::VecDeque;

const SYNC_WORD: u16 = 0x3FFD;
const FRAME_BITS: usize = 80;
const SYNC_START: usize = 64;

/// Decodes one aligned 80-bit LTC frame. Bits are in transmission order,
/// least-significant bit first per byte.
pub fn decode_bits(bits: &[bool; FRAME_BITS], rate: FrameRate) -> Option<Timecode> {
    let sync = u16::from_le_bytes([byte_at(bits, SYNC_START), byte_at(bits, SYNC_START + 8)]);
    if sync != SYNC_WORD {
        return None;
    }

    let frame_byte = byte_at(bits, 0);
    let seconds_byte = byte_at(bits, 8);
    let minutes_byte = byte_at(bits, 16);
    let hours_byte = byte_at(bits, 24);

    let drop = frame_byte & 0x40 != 0;
    let rate = rate.with_drop_flag(drop);

    Timecode::new(
        (hours_byte & 0x0F) + 10 * ((hours_byte >> 4) & 0x03),
        (minutes_byte & 0x0F) + 10 * ((minutes_byte >> 4) & 0x03),
        (seconds_byte & 0x0F) + 10 * ((seconds_byte >> 4) & 0x03),
        (frame_byte & 0x0F) + 10 * ((frame_byte >> 4) & 0x03),
        rate,
    )
    .ok()
}

fn byte_at(bits: &[bool; FRAME_BITS], offset: usize) -> u8 {
    (0..8).fold(0, |byte, index| {
        byte | (u8::from(bits[offset + index]) << index)
    })
}

/// Sliding 80-bit window that finds frame sync, then reports each frame.
#[derive(Debug, Clone)]
pub struct LtcBitDecoder {
    window: VecDeque<bool>,
    rate: FrameRate,
}

impl LtcBitDecoder {
    pub fn new(rate: FrameRate) -> Self {
        Self {
            window: VecDeque::with_capacity(FRAME_BITS),
            rate,
        }
    }

    pub fn push_bit(&mut self, bit: bool) -> Option<Timecode> {
        self.window.push_back(bit);
        if self.window.len() > FRAME_BITS {
            self.window.pop_front();
        }
        if self.window.len() < FRAME_BITS {
            return None;
        }
        let bits: [bool; FRAME_BITS] = std::array::from_fn(|index| self.window[index]);
        let timecode = decode_bits(&bits, self.rate)?;
        self.window.clear();
        Some(timecode)
    }
}

/// Converts biphase-mark transitions into bits. Biphase mark emits a
/// transition at every cell boundary, plus a mid-cell transition for a one.
#[derive(Debug, Clone)]
pub struct LtcTransitionDecoder {
    sample_rate: f64,
    rate: FrameRate,
    last_transition: Option<u64>,
    pending_half: bool,
    bits: LtcBitDecoder,
}

impl LtcTransitionDecoder {
    pub fn new(sample_rate: f64, rate: FrameRate) -> Self {
        Self {
            sample_rate,
            rate,
            last_transition: None,
            pending_half: false,
            bits: LtcBitDecoder::new(rate),
        }
    }

    pub fn set_rate(&mut self, rate: FrameRate) {
        self.rate = rate;
        self.bits = LtcBitDecoder::new(rate);
        self.pending_half = false;
    }

    pub fn push_transition(&mut self, sample_index: u64) -> Option<Timecode> {
        let last = self.last_transition.replace(sample_index)?;
        if sample_index <= last {
            self.pending_half = false;
            return None;
        }
        let delta = (sample_index - last) as f64;
        let period = self.sample_rate / self.rate.actual_fps();

        if delta < period * 0.75 {
            if self.pending_half {
                self.pending_half = false;
                self.bits.push_bit(true)
            } else {
                self.pending_half = true;
                None
            }
        } else if delta <= period * 1.5 {
            self.pending_half = false;
            self.bits.push_bit(false)
        } else {
            self.pending_half = false;
            None
        }
    }
}

/// Detects sign changes in LTC audio and feeds the transition decoder.
#[derive(Debug, Clone)]
pub struct LtcSampleDecoder {
    transitions: LtcTransitionDecoder,
    index: u64,
    positive: Option<bool>,
}

impl LtcSampleDecoder {
    pub fn new(sample_rate: f64, rate: FrameRate) -> Self {
        Self {
            transitions: LtcTransitionDecoder::new(sample_rate, rate),
            index: 0,
            positive: None,
        }
    }

    pub fn set_rate(&mut self, rate: FrameRate) {
        self.transitions.set_rate(rate);
    }

    /// Feeds one mono sample. Use channel 0 for multi-channel input.
    pub fn push_sample(&mut self, sample: f32) -> Option<Timecode> {
        let positive = sample >= 0.0;
        let output = match self.positive {
            Some(previous) if previous != positive => self.transitions.push_transition(self.index),
            Some(_) => None,
            None => None,
        };
        self.positive = Some(positive);
        self.index += 1;
        output
    }

    pub fn push_samples(&mut self, samples: &[f32]) -> Vec<Timecode> {
        let mut output = Vec::new();
        for sample in samples {
            if let Some(timecode) = self.push_sample(*sample) {
                output.push(timecode);
            }
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame_bits(timecode: Timecode) -> [bool; FRAME_BITS] {
        let drop = if timecode.rate.drop_frame() { 0x40 } else { 0 };
        let bytes = [
            (timecode.frames % 10) | ((timecode.frames / 10) << 4) | drop,
            (timecode.seconds % 10) | ((timecode.seconds / 10) << 4),
            (timecode.minutes % 10) | ((timecode.minutes / 10) << 4),
            (timecode.hours % 10) | ((timecode.hours / 10) << 4),
            0,
            0,
            0,
            0,
            0xFD,
            0x3F,
        ];
        let mut bits = [false; FRAME_BITS];
        for (byte_index, byte) in bytes.iter().enumerate() {
            for bit in 0..8 {
                bits[byte_index * 8 + bit] = (byte >> bit) & 1 == 1;
            }
        }
        bits
    }

    fn transitions(bits: &[bool], period: f64) -> Vec<u64> {
        let mut output = Vec::new();
        let mut position: f64 = 0.0;
        for bit in bits {
            output.push(position.round() as u64);
            if *bit {
                output.push((position + period / 2.0).round() as u64);
            }
            position += period;
        }
        output.push(position.round() as u64);
        output
    }

    #[test]
    fn decodes_a_bit_aligned_frame() {
        let timecode = Timecode::new(1, 2, 3, 4, FrameRate::Fps25).unwrap();
        let bits = frame_bits(timecode);
        assert_eq!(decode_bits(&bits, FrameRate::Fps25), Some(timecode));
    }

    #[test]
    fn rejects_bad_sync() {
        let mut bits = frame_bits(Timecode::new(0, 0, 0, 0, FrameRate::Fps25).unwrap());
        bits[64] = !bits[64];
        assert_eq!(decode_bits(&bits, FrameRate::Fps25), None);
    }

    #[test]
    fn decodes_transitions_into_timecode() {
        let timecode = Timecode::new(0, 0, 10, 12, FrameRate::Fps25).unwrap();
        let sample_rate = 48_000.0;
        let period = sample_rate / FrameRate::Fps25.actual_fps();
        let mut decoder = LtcTransitionDecoder::new(sample_rate, FrameRate::Fps25);
        let mut output = None;
        for transition in transitions(&frame_bits(timecode), period) {
            if let Some(decoded) = decoder.push_transition(transition) {
                output = Some(decoded);
            }
        }
        assert_eq!(output, Some(timecode));
    }

    #[test]
    fn decodes_square_wave_samples() {
        let timecode = Timecode::new(10, 20, 30, 5, FrameRate::Fps25).unwrap();
        let sample_rate = 48_000.0;
        let period = sample_rate / FrameRate::Fps25.actual_fps();
        let mut bits = Vec::with_capacity(FRAME_BITS * 2);
        bits.extend_from_slice(&frame_bits(timecode));
        bits.extend_from_slice(&frame_bits(timecode));
        let transition_points = transitions(&bits, period);

        let mut samples = Vec::new();
        let mut positive = true;
        let mut cursor = 0u64;
        for transition in &transition_points {
            while cursor < *transition {
                samples.push(if positive { 1.0 } else { -1.0 });
                cursor += 1;
            }
            positive = !positive;
        }
        samples.push(if positive { 1.0 } else { -1.0 });

        let mut decoder = LtcSampleDecoder::new(sample_rate, FrameRate::Fps25);
        let decoded = decoder.push_samples(&samples);
        assert_eq!(decoded.last().copied(), Some(timecode));
    }

    #[test]
    fn drop_frame_flag_switches_the_rate() {
        let timecode = Timecode::new(0, 10, 0, 0, FrameRate::Fps29_97Drop).unwrap();
        let bits = frame_bits(timecode);
        let decoded = decode_bits(&bits, FrameRate::Fps30).unwrap();
        assert_eq!(decoded.rate, FrameRate::Fps29_97Drop);
        assert_eq!(decoded.to_string(), "00:10:00;00");
    }
}
