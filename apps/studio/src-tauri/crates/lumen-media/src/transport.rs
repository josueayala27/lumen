//! Per-video transport: play, pause, seek and rate on a monotonic clock.
//!
//! The decoder thread reads `position_ms` every tick, so a seek takes effect on
//! the next frame. `generation` changes only when a decoder that streams
//! (ffmpeg) must restart; Hap decoders follow the position directly.

use std::time::{Duration, Instant};

use crate::AV_SYNC_TOLERANCE_MS;

#[derive(Debug, Clone, PartialEq)]
pub struct VideoTransport {
    anchor_position_ms: f64,
    anchor: Instant,
    playing: bool,
    rate: f64,
    generation: u64,
}

/// A transport change requested by the show: any field left `None` is kept.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct TransportCommand {
    pub playing: Option<bool>,
    pub position_ms: Option<u64>,
    pub rate: Option<f64>,
}

impl VideoTransport {
    pub fn new(position_ms: u64, playing: bool, now: Instant) -> Self {
        Self {
            anchor_position_ms: position_ms as f64,
            anchor: now,
            playing,
            rate: 1.0,
            generation: 0,
        }
    }

    /// Clip position at `now`, never negative.
    pub fn position_ms(&self, now: Instant) -> u64 {
        let elapsed = if self.playing {
            now.saturating_duration_since(self.anchor).as_secs_f64() * 1000.0 * self.rate
        } else {
            0.0
        };
        (self.anchor_position_ms + elapsed).max(0.0) as u64
    }

    pub fn playing(&self) -> bool {
        self.playing
    }

    pub fn rate(&self) -> f64 {
        self.rate
    }

    pub fn generation(&self) -> u64 {
        self.generation
    }

    fn reanchor(&mut self, now: Instant) {
        self.anchor_position_ms = self.position_ms(now) as f64;
        self.anchor = now;
    }

    pub fn play(&mut self, now: Instant) {
        if !self.playing {
            self.reanchor(now);
            self.playing = true;
            self.generation += 1;
        }
    }

    pub fn pause(&mut self, now: Instant) {
        if self.playing {
            self.reanchor(now);
            self.playing = false;
            self.generation += 1;
        }
    }

    /// Moves to `position_ms`. A running clip already within the A/V tolerance is
    /// only re-anchored, so periodic resyncs from the show clock never restart a
    /// streaming decoder.
    pub fn seek(&mut self, position_ms: u64, now: Instant) {
        let current = self.position_ms(now);
        let drift = current.abs_diff(position_ms);
        self.anchor_position_ms = position_ms as f64;
        self.anchor = now;
        if !(self.playing && drift <= AV_SYNC_TOLERANCE_MS) {
            self.generation += 1;
        }
    }

    pub fn set_rate(&mut self, rate: f64, now: Instant) {
        let rate = if rate.is_finite() { rate.clamp(0.0, 8.0) } else { 1.0 };
        if (rate - self.rate).abs() > f64::EPSILON {
            self.reanchor(now);
            self.rate = rate;
            self.generation += 1;
        }
    }

    /// Applies a command in a fixed order: rate, then position, then play state.
    pub fn apply(&mut self, command: TransportCommand, now: Instant) {
        if let Some(rate) = command.rate {
            self.set_rate(rate, now);
        }
        if let Some(position) = command.position_ms {
            self.seek(position, now);
        }
        match command.playing {
            Some(true) => self.play(now),
            Some(false) => self.pause(now),
            None => {}
        }
    }

    /// Time until the position reaches `target_ms`, for scheduling the next frame.
    pub fn wait_until(&self, target_ms: u64, now: Instant) -> Duration {
        if !self.playing || self.rate <= 0.0 {
            return Duration::from_millis(50);
        }
        let remaining = target_ms.saturating_sub(self.position_ms(now)) as f64 / self.rate;
        Duration::from_millis(remaining.clamp(1.0, 50.0) as u64)
    }
}

/// Folds a clip position into the clip: wraps when looping, otherwise clamps to
/// the end. Returns the position and whether a non-looping clip has finished.
pub fn clip_position(position_ms: u64, duration_ms: u64, looping: bool) -> (u64, bool) {
    let duration = duration_ms.max(1);
    if position_ms < duration {
        (position_ms, false)
    } else if looping {
        (position_ms % duration, false)
    } else {
        (duration - 1, true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(start: Instant, ms: u64) -> Instant {
        start + Duration::from_millis(ms)
    }

    #[test]
    fn plays_pauses_and_resumes() {
        let start = Instant::now();
        let mut transport = VideoTransport::new(1000, true, start);
        assert_eq!(transport.position_ms(at(start, 500)), 1500);
        transport.pause(at(start, 500));
        assert_eq!(transport.position_ms(at(start, 5000)), 1500);
        transport.play(at(start, 6000));
        assert_eq!(transport.position_ms(at(start, 6250)), 1750);
        assert_eq!(transport.generation(), 2);
    }

    #[test]
    fn small_seeks_while_playing_keep_the_generation() {
        let start = Instant::now();
        let mut transport = VideoTransport::new(0, true, start);
        transport.seek(1030, at(start, 1000));
        assert_eq!(transport.generation(), 0);
        assert_eq!(transport.position_ms(at(start, 1000)), 1030);
        transport.seek(5000, at(start, 1000));
        assert_eq!(transport.generation(), 1);
        transport.pause(at(start, 1000));
        transport.seek(5010, at(start, 1000));
        assert_eq!(transport.generation(), 3);
    }

    #[test]
    fn rate_scales_time() {
        let start = Instant::now();
        let mut transport = VideoTransport::new(0, true, start);
        transport.set_rate(2.0, start);
        assert_eq!(transport.position_ms(at(start, 100)), 200);
        transport.set_rate(f64::NAN, at(start, 100));
        assert_eq!(transport.rate(), 1.0);
        assert_eq!(transport.position_ms(at(start, 200)), 300);
    }

    #[test]
    fn commands_apply_in_order() {
        let start = Instant::now();
        let mut transport = VideoTransport::new(0, false, start);
        transport.apply(
            TransportCommand { playing: Some(true), position_ms: Some(2000), rate: None },
            start,
        );
        assert!(transport.playing());
        assert_eq!(transport.position_ms(at(start, 100)), 2100);
    }

    #[test]
    fn clip_positions_loop_or_hold() {
        assert_eq!(clip_position(500, 1000, false), (500, false));
        assert_eq!(clip_position(2500, 1000, true), (500, false));
        assert_eq!(clip_position(2500, 1000, false), (999, true));
        assert_eq!(clip_position(3, 0, true), (0, false));
    }

    #[test]
    fn waits_are_bounded() {
        let start = Instant::now();
        let transport = VideoTransport::new(0, true, start);
        assert_eq!(transport.wait_until(20, start), Duration::from_millis(20));
        assert_eq!(transport.wait_until(10_000, start), Duration::from_millis(50));
        assert_eq!(VideoTransport::new(0, false, start).wait_until(20, start), Duration::from_millis(50));
    }
}
