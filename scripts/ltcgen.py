#!/usr/bin/env python3
"""Generate a mono LTC WAV for local testing.

Example:
  python3 scripts/ltcgen.py --fps 25 --start 00:00:00:00 --seconds 30 --out /tmp/ltc.wav

Play it into a loopback input (BlackHole, an audio interface, or a physical
LTC feed) and select that input in Settings -> Show control.
"""

from __future__ import annotations

import argparse
import math
import struct
import wave

NOMINAL = {"23.976": 24, "24": 24, "25": 25, "29.97": 30, "29.97df": 30, "30": 30}
ACTUAL = {
    "23.976": 24000 / 1001,
    "24": 24.0,
    "25": 25.0,
    "29.97": 30000 / 1001,
    "29.97df": 30000 / 1001,
    "30": 30.0,
}


def frame_count(hours: int, minutes: int, seconds: int, frames: int, rate: str) -> int:
    nominal = NOMINAL[rate]
    count = (hours * 3600 + minutes * 60 + seconds) * nominal + frames
    if rate == "29.97df":
        total_minutes = hours * 60 + minutes
        count -= 2 * (total_minutes - total_minutes // 10)
    return count


def timecode_from_frames(count: int, rate: str) -> tuple[int, int, int, int]:
    if rate == "29.97df":
        tens, remainder = divmod(count, 17_982)
        count += 18 * tens + 2 * (max(0, remainder - 2) // 1_798)
    nominal = NOMINAL[rate]
    hours, rest = divmod(count, nominal * 3600)
    minutes, rest = divmod(rest, nominal * 60)
    seconds, frames = divmod(rest, nominal)
    return hours % 24, minutes, seconds, frames


def parse_start(value: str) -> tuple[int, int, int, int]:
    parts = value.replace(";", ":").split(":")
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("start must be HH:MM:SS:FF")
    return tuple(int(part) for part in parts)  # type: ignore[return-value]


def frame_bits(hours: int, minutes: int, seconds: int, frames: int, rate: str) -> list[int]:
    drop = 0x40 if rate == "29.97df" else 0
    payload = [
        (frames % 10) | ((frames // 10) << 4) | drop,
        (seconds % 10) | ((seconds // 10) << 4),
        (minutes % 10) | ((minutes // 10) << 4),
        (hours % 10) | ((hours // 10) << 4),
        0,
        0,
        0,
        0,
        0xFD,
        0x3F,
    ]
    bits: list[int] = []
    for byte in payload:
        bits.extend((byte >> bit) & 1 for bit in range(8))
    return bits


def generate(
    rate: str,
    start: tuple[int, int, int, int],
    seconds: float,
    sample_rate: int,
    amplitude: float,
) -> bytes:
    fps = ACTUAL[rate]
    period = sample_rate / (fps * 80.0)
    frames = max(1, math.ceil(seconds * fps))
    first = frame_count(*start, rate)
    samples: list[int] = []
    position = 0.0
    polarity = 1
    value = int(max(0.0, min(1.0, amplitude)) * 32767)

    def emit(until: float, sign: int) -> None:
        target = round(until)
        while len(samples) < target:
            samples.append(value * sign)

    for index in range(frames):
        hours, minutes, secs, frame = timecode_from_frames(first + index, rate)
        bits = frame_bits(hours, minutes, secs, frame, rate)
        for bit in bits:
            start_sample = position
            mid_sample = start_sample + period / 2.0
            end_sample = start_sample + period
            polarity = -polarity
            emit(mid_sample, polarity)
            if bit:
                polarity = -polarity
            emit(end_sample, polarity)
            position = end_sample

    # Close the final bit cell so the decoder can emit the last frame.
    polarity = -polarity
    emit(position + period, polarity)

    return b"".join(struct.pack("<h", sample) for sample in samples)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate a mono LTC WAV")
    parser.add_argument("--fps", choices=sorted(NOMINAL), default="25")
    parser.add_argument("--start", default="00:00:00:00", type=parse_start)
    parser.add_argument("--seconds", type=float, default=30.0)
    parser.add_argument("--sample-rate", type=int, default=48_000)
    parser.add_argument("--amplitude", type=float, default=0.25)
    parser.add_argument("--out", default="ltc.wav")
    args = parser.parse_args()

    audio = generate(args.fps, args.start, args.seconds, args.sample_rate, args.amplitude)
    with wave.open(args.out, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(args.sample_rate)
        output.writeframes(audio)
    print(f"wrote {args.out}: {len(audio) // 2} samples, {args.fps}, start {args.start}")


if __name__ == "__main__":
    main()
