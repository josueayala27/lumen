//! SMPTE timecode math and the clock that follows an external timecode source.

use serde::{Deserialize, Serialize};
use std::fmt;

/// SMPTE frame rates used by MTC and LTC. Drop-frame is 29.97 with the
/// standard two-frame drop every minute except every tenth minute.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum FrameRate {
    #[serde(rename = "23.976")]
    Fps23_976,
    #[serde(rename = "24")]
    Fps24,
    #[serde(rename = "25")]
    Fps25,
    #[serde(rename = "29.97")]
    Fps29_97,
    #[serde(rename = "29.97df")]
    Fps29_97Drop,
    #[serde(rename = "30")]
    Fps30,
}

impl FrameRate {
    /// Frame numbers counted per timecode second.
    pub const fn nominal_fps(self) -> u32 {
        match self {
            Self::Fps23_976 | Self::Fps24 => 24,
            Self::Fps25 => 25,
            Self::Fps29_97 | Self::Fps29_97Drop | Self::Fps30 => 30,
        }
    }

    /// Real elapsed frames per second.
    pub const fn actual_fps(self) -> f64 {
        match self {
            Self::Fps23_976 => 24_000.0 / 1_001.0,
            Self::Fps24 => 24.0,
            Self::Fps25 => 25.0,
            Self::Fps29_97 | Self::Fps29_97Drop => 30_000.0 / 1_001.0,
            Self::Fps30 => 30.0,
        }
    }

    pub const fn drop_frame(self) -> bool {
        matches!(self, Self::Fps29_97Drop)
    }

    /// MTC frame-rate bits: 00 = 24, 01 = 25, 10 = 30 drop, 11 = 30 non-drop.
    pub const fn from_mtc_bits(bits: u8) -> Self {
        match bits & 0b11 {
            0b00 => Self::Fps24,
            0b01 => Self::Fps25,
            0b10 => Self::Fps29_97Drop,
            _ => Self::Fps30,
        }
    }

    pub const fn mtc_bits(self) -> u8 {
        match self {
            Self::Fps23_976 | Self::Fps24 => 0b00,
            Self::Fps25 => 0b01,
            Self::Fps29_97 | Self::Fps29_97Drop => 0b10,
            Self::Fps30 => 0b11,
        }
    }

    /// Applies the LTC/MTC drop-frame flag to a nominal rate.
    pub const fn with_drop_flag(self, drop: bool) -> Self {
        match (self, drop) {
            (Self::Fps29_97 | Self::Fps29_97Drop | Self::Fps30, true) => Self::Fps29_97Drop,
            (Self::Fps29_97Drop, false) => Self::Fps29_97,
            (rate, _) => rate,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TimecodeError {
    Format,
    OutOfRange(&'static str),
    DroppedLabel,
}

impl fmt::Display for TimecodeError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Format => write!(formatter, "timecode must be HH:MM:SS:FF or HH:MM:SS;FF"),
            Self::OutOfRange(field) => write!(formatter, "timecode {field} out of range"),
            Self::DroppedLabel => write!(formatter, "timecode uses a dropped frame label"),
        }
    }
}

impl std::error::Error for TimecodeError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Timecode {
    pub hours: u8,
    pub minutes: u8,
    pub seconds: u8,
    pub frames: u8,
    pub rate: FrameRate,
}

impl Timecode {
    pub fn new(
        hours: u8,
        minutes: u8,
        seconds: u8,
        frames: u8,
        rate: FrameRate,
    ) -> Result<Self, TimecodeError> {
        let timecode = Self {
            hours,
            minutes,
            seconds,
            frames,
            rate,
        };
        timecode.validate()?;
        Ok(timecode)
    }

    pub fn validate(&self) -> Result<(), TimecodeError> {
        if self.hours > 23 {
            return Err(TimecodeError::OutOfRange("hours"));
        }
        if self.minutes > 59 {
            return Err(TimecodeError::OutOfRange("minutes"));
        }
        if self.seconds > 59 {
            return Err(TimecodeError::OutOfRange("seconds"));
        }
        if u32::from(self.frames) >= self.rate.nominal_fps() {
            return Err(TimecodeError::OutOfRange("frames"));
        }
        if self.rate.drop_frame()
            && self.seconds == 0
            && self.frames < 2
            && !self.minutes.is_multiple_of(10)
        {
            return Err(TimecodeError::DroppedLabel);
        }
        Ok(())
    }

    pub fn parse(input: &str, rate: FrameRate) -> Result<Self, TimecodeError> {
        let separator = if input.contains(';') {
            FrameRate::Fps29_97Drop
        } else {
            rate
        };
        let normalized = input.replace(';', ":");
        let parts: Vec<&str> = normalized.split(':').collect();
        if parts.len() != 4 {
            return Err(TimecodeError::Format);
        }
        let mut values = [0u8; 4];
        for (index, part) in parts.iter().enumerate() {
            if part.len() != 2 {
                return Err(TimecodeError::Format);
            }
            values[index] = part.parse().map_err(|_| TimecodeError::Format)?;
        }
        Self::new(values[0], values[1], values[2], values[3], separator)
    }

    /// Frame count elapsed since 00:00:00:00. Drop-frame counts real frames,
    /// so labels such as 00:01:00;00 are not representable and are rejected.
    pub fn to_frames(self) -> u64 {
        let nominal = u64::from(self.rate.nominal_fps());
        let base =
            (u64::from(self.hours) * 3600 + u64::from(self.minutes) * 60 + u64::from(self.seconds))
                * nominal
                + u64::from(self.frames);
        if self.rate.drop_frame() {
            let total_minutes = u64::from(self.hours) * 60 + u64::from(self.minutes);
            base - 2 * (total_minutes - total_minutes / 10)
        } else {
            base
        }
    }

    pub fn from_frames(frames: u64, rate: FrameRate) -> Self {
        let nominal = u64::from(rate.nominal_fps());
        let frames = if rate.drop_frame() {
            let ten_minutes = 17_982;
            let minute = 1_798;
            let tens = frames / ten_minutes;
            let remainder = frames % ten_minutes;
            frames + 18 * tens + 2 * (remainder.saturating_sub(2) / minute)
        } else {
            frames
        };
        let per_hour = nominal * 3600;
        let per_minute = nominal * 60;
        Self {
            hours: (frames / per_hour) as u8 % 24,
            minutes: ((frames % per_hour) / per_minute) as u8,
            seconds: ((frames % per_minute) / nominal) as u8,
            frames: (frames % nominal) as u8,
            rate,
        }
    }

    pub fn advance(self, frames: i64) -> Self {
        let current = self.to_frames() as i64;
        Self::from_frames((current + frames).max(0) as u64, self.rate)
    }

    pub fn with_rate(self, rate: FrameRate) -> Self {
        Self { rate, ..self }
    }
}

impl fmt::Display for Timecode {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let separator = if self.rate.drop_frame() { ';' } else { ':' };
        write!(
            formatter,
            "{:02}:{:02}:{:02}{}{:02}",
            self.hours, self.minutes, self.seconds, separator, self.frames
        )
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TimecodeSource {
    Ltc,
    Mtc,
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimecodeSnapshot {
    pub timecode: Option<Timecode>,
    pub locked: bool,
    pub source: Option<TimecodeSource>,
}

/// Holds the last received timecode and extrapolates it between frames.
#[derive(Debug, Clone)]
pub struct TimecodeSync {
    last: Option<Timecode>,
    received_at_ms: Option<u64>,
    source: Option<TimecodeSource>,
    timeout_ms: u64,
}

impl TimecodeSync {
    pub fn new(timeout_ms: u64) -> Self {
        Self {
            last: None,
            received_at_ms: None,
            source: None,
            timeout_ms,
        }
    }

    pub fn update(&mut self, timecode: Timecode, now_ms: u64, source: TimecodeSource) {
        self.last = Some(timecode);
        self.received_at_ms = Some(now_ms);
        self.source = Some(source);
    }

    pub fn clear(&mut self) {
        self.last = None;
        self.received_at_ms = None;
        self.source = None;
    }

    pub fn snapshot(&self, now_ms: u64) -> TimecodeSnapshot {
        let Some(last) = self.last else {
            return TimecodeSnapshot {
                timecode: None,
                locked: false,
                source: None,
            };
        };
        let locked = self
            .received_at_ms
            .is_some_and(|received| now_ms.saturating_sub(received) <= self.timeout_ms);
        let timecode = if locked {
            let elapsed_ms = now_ms.saturating_sub(self.received_at_ms.unwrap_or(now_ms));
            let elapsed_frames =
                (elapsed_ms as f64 * last.rate.actual_fps() / 1000.0).round() as i64;
            last.advance(elapsed_frames)
        } else {
            last
        };
        TimecodeSnapshot {
            timecode: Some(timecode),
            locked,
            source: self.source,
        }
    }
}

impl Default for TimecodeSync {
    fn default() -> Self {
        Self::new(1_000)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_and_formats_non_drop_timecode() {
        let timecode = Timecode::parse("01:02:03:04", FrameRate::Fps25).unwrap();
        assert_eq!(timecode.to_string(), "01:02:03:04");
        assert_eq!(timecode.to_frames(), (3_723 * 25) + 4);
        assert_eq!(
            Timecode::from_frames(timecode.to_frames(), FrameRate::Fps25),
            timecode
        );
    }

    #[test]
    fn drop_frame_skips_two_labels_per_minute() {
        let after_minute = Timecode::from_frames(1_800, FrameRate::Fps29_97Drop);
        assert_eq!(after_minute.to_string(), "00:01:00;02");
        assert_eq!(after_minute.to_frames(), 1_800);

        let ten_minutes = Timecode::from_frames(17_982, FrameRate::Fps29_97Drop);
        assert_eq!(ten_minutes.to_string(), "00:10:00;00");
        assert_eq!(ten_minutes.to_frames(), 17_982);
    }

    #[test]
    fn rejects_dropped_labels() {
        assert_eq!(
            Timecode::new(0, 1, 0, 0, FrameRate::Fps29_97Drop),
            Err(TimecodeError::DroppedLabel)
        );
        assert!(Timecode::new(0, 10, 0, 0, FrameRate::Fps29_97Drop).is_ok());
    }

    #[test]
    fn sync_extrapolates_between_source_frames() {
        let mut sync = TimecodeSync::new(1_000);
        sync.update(
            Timecode::new(0, 0, 10, 0, FrameRate::Fps25).unwrap(),
            5_000,
            TimecodeSource::Ltc,
        );
        let snapshot = sync.snapshot(5_040);
        assert!(snapshot.locked);
        assert_eq!(snapshot.timecode.unwrap().to_string(), "00:00:10:01");

        let dropped = sync.snapshot(7_000);
        assert!(!dropped.locked);
        assert_eq!(dropped.timecode.unwrap().to_string(), "00:00:10:00");
    }
}
