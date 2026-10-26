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

/// Selects `channel` from an interleaved audio frame. Falls back to the first
/// channel when `channel` is out of range. Returns `None` for an empty frame.
pub fn channel_sample<T: Copy>(frame: &[T], channel: usize) -> Option<T> {
    frame.get(channel).or_else(|| frame.first()).copied()
}

/// Schmitt-trigger polarity. The polarity only changes once the sample
/// crosses the threshold in the opposite direction, so silence and low-level
/// noise keep the previous state.
fn update_polarity(previous: Option<bool>, sample: f32, threshold: f32) -> Option<bool> {
    if sample >= threshold {
        Some(true)
    } else if sample <= -threshold {
        Some(false)
    } else {
        previous
    }
}

/// Detects sign changes in LTC audio and feeds the transition decoder.
///
/// Samples inside `±threshold` do not change polarity. This rejects silence
/// and low-level noise that would otherwise produce spurious transitions.
#[derive(Debug, Clone)]
pub struct LtcSampleDecoder {
    transitions: LtcTransitionDecoder,
    index: u64,
    polarity: Option<bool>,
    threshold: f32,
}

impl LtcSampleDecoder {
    /// Default amplitude threshold, about -34 dBFS. Broadcast LTC is usually
    /// recorded well above this level.
    pub const DEFAULT_THRESHOLD: f32 = 0.02;

    pub fn new(sample_rate: f64, rate: FrameRate) -> Self {
        Self::with_threshold(sample_rate, rate, Self::DEFAULT_THRESHOLD)
    }

    pub fn with_threshold(sample_rate: f64, rate: FrameRate, threshold: f32) -> Self {
        Self {
            transitions: LtcTransitionDecoder::new(sample_rate, rate),
            index: 0,
            polarity: None,
            threshold: threshold.abs().min(1.0),
        }
    }

    pub fn set_rate(&mut self, rate: FrameRate) {
        self.transitions.set_rate(rate);
    }

    /// Sets the amplitude threshold in normalized sample units. Values are
    /// clamped to `0.0..=1.0`.
    pub fn set_threshold(&mut self, threshold: f32) {
        self.threshold = threshold.abs().min(1.0);
    }

    /// Feeds one mono sample taken from the selected input channel.
    pub fn push_sample(&mut self, sample: f32) -> Option<Timecode> {
        let polarity = update_polarity(self.polarity, sample, self.threshold);
        let output = match (self.polarity, polarity) {
            (Some(previous), Some(current)) if previous != current => {
                self.transitions.push_transition(self.index)
            }
            _ => None,
        };
        self.polarity = polarity;
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

    #[test]
    fn channel_sample_selects_the_requested_channel() {
        let frame = [0.1, -0.4, 0.9, 0.2];
        assert_eq!(channel_sample(&frame, 0), Some(0.1));
        assert_eq!(channel_sample(&frame, 1), Some(-0.4));
        assert_eq!(channel_sample(&frame, 3), Some(0.2));
    }

    #[test]
    fn channel_sample_falls_back_to_the_first_channel() {
        let frame = [0.1, -0.4];
        assert_eq!(channel_sample(&frame, 7), Some(0.1));
        assert_eq!(channel_sample::<f32>(&[], 0), None);
    }

    #[test]
    fn hysteresis_ignores_low_level_noise() {
        let threshold = LtcSampleDecoder::DEFAULT_THRESHOLD;
        let mut polarity = None;
        for sample in [0.0, 0.01, -0.01, 0.019, -0.019] {
            polarity = update_polarity(polarity, sample, threshold);
        }
        assert_eq!(polarity, None);

        let mut polarity = Some(true);
        for sample in [-0.01, 0.019, -0.019, 0.0] {
            polarity = update_polarity(polarity, sample, threshold);
            assert_eq!(polarity, Some(true));
        }

        assert_eq!(update_polarity(Some(true), -threshold, threshold), Some(false));
        assert_eq!(update_polarity(Some(false), threshold, threshold), Some(true));
    }

    #[test]
    fn low_level_noise_produces_no_timecode() {
        let mut decoder = LtcSampleDecoder::new(48_000.0, FrameRate::Fps25);
        let noise: Vec<f32> = (0..48_000)
            .map(|index| if index % 2 == 0 { 0.01 } else { -0.01 })
            .collect();
        assert!(decoder.push_samples(&noise).is_empty());
    }
}
