//! Typed parameters for effect passes and shader generators.
//!
//! Names and defaults mirror `EFFECT_CATALOG` in packages/schema/src/composition.ts and
//! `SHADER_CATALOG` in apps/studio/app/compose/composeModel.ts. Each pass reads its parameters
//! from a small block of `vec4<f32>` in `compositor.wgsl`. No wgpu here.

use crate::color::ClearColor;
use crate::composition::{EffectKind, ParamValue, Params};

/// Parameter block for one pass.
pub type ParamBlock = [[f32; 4]; 4];

/// sRGB transfer to linear light.
pub fn srgb_to_linear(value: f64) -> f64 {
    if value <= 0.04045 {
        value / 12.92
    } else {
        ((value + 0.055) / 1.055).powf(2.4)
    }
}

/// A contract colour as straight-alpha linear RGBA.
pub fn linear_color(value: &str) -> Option<[f32; 4]> {
    let color = ClearColor::parse(value)?;
    Some([
        srgb_to_linear(color.r) as f32,
        srgb_to_linear(color.g) as f32,
        srgb_to_linear(color.b) as f32,
        color.a as f32,
    ])
}

fn number(params: &Params, name: &str, default: f64) -> f32 {
    match params.get(name) {
        Some(ParamValue::Number(value)) if value.is_finite() => *value as f32,
        Some(ParamValue::Bool(value)) => f32::from(u8::from(*value)),
        _ => default as f32,
    }
}

fn boolean(params: &Params, name: &str, default: bool) -> f32 {
    let value = match params.get(name) {
        Some(ParamValue::Bool(value)) => *value,
        Some(ParamValue::Number(value)) => *value != 0.0,
        _ => default,
    };
    f32::from(u8::from(value))
}

fn color(params: &Params, name: &str, default: &str) -> [f32; 4] {
    match params.get(name) {
        Some(ParamValue::Text(value)) => linear_color(value),
        _ => None,
    }
    .or_else(|| linear_color(default))
    .unwrap_or([1.0; 4])
}

fn text<'a>(params: &'a Params, name: &str, default: &'a str) -> &'a str {
    match params.get(name) {
        Some(ParamValue::Text(value)) => value,
        _ => default,
    }
}

/// Parameters for one effect pass. Angles are radians. Blur radius is in canvas pixels; the
/// compositor scales it to the render size.
pub fn effect_params(kind: EffectKind, params: &Params) -> ParamBlock {
    let mut block = [[0.0; 4]; 4];
    match kind {
        EffectKind::Color => {
            block[0] = [
                number(params, "brightness", 0.0),
                number(params, "contrast", 1.0),
                number(params, "saturation", 1.0),
                number(params, "hue", 0.0).to_radians(),
            ];
            let tint = color(params, "tint", "#ffffff");
            block[1] = [tint[0], tint[1], tint[2], number(params, "tintAmount", 0.0)];
        }
        EffectKind::Blur => {
            block[0] = [number(params, "radius", 8.0).max(0.0), 0.0, 0.0, 0.0];
        }
        EffectKind::Key => {
            let mode = if text(params, "mode", "chroma") == "luma" {
                1.0
            } else {
                0.0
            };
            block[0] = [
                mode,
                number(params, "threshold", 0.4),
                number(params, "softness", 0.1).max(0.0),
                boolean(params, "invert", false),
            ];
            let key = color(params, "keyColor", "#00ff00");
            block[1] = [key[0], key[1], key[2], 1.0];
        }
        EffectKind::Transform => {
            block[0] = [
                number(params, "scale", 1.0),
                number(params, "offsetX", 0.0),
                number(params, "offsetY", 0.0),
                number(params, "rotate", 0.0).to_radians(),
            ];
            block[1] = [
                boolean(params, "mirrorX", false),
                boolean(params, "mirrorY", false),
                0.0,
                0.0,
            ];
        }
        EffectKind::Kaleidoscope => {
            block[0] = [
                number(params, "segments", 6.0).round().max(2.0),
                number(params, "rotate", 0.0).to_radians(),
                number(params, "centerX", 0.5),
                number(params, "centerY", 0.5),
            ];
        }
        EffectKind::Feedback => {
            block[0] = [
                number(params, "amount", 0.8).clamp(0.0, 1.0),
                number(params, "zoom", 1.02).max(0.01),
                number(params, "rotate", 0.0).to_radians(),
                0.0,
            ];
        }
    }
    block
}

/// Built-in WGSL generators. Codes match `fs_generator` in `compositor.wgsl`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Generator {
    Noise = 3,
    Plasma = 4,
    Lines = 5,
}

impl Generator {
    pub fn parse(shader_id: &str) -> Option<Self> {
        Some(match shader_id {
            "noise" => Self::Noise,
            "plasma" => Self::Plasma,
            "lines" => Self::Lines,
            _ => return None,
        })
    }
}

/// Parameters for a shader generator: `[speed-scaled params, colour A, colour B, unused]`.
pub fn generator_params(generator: Generator, params: &Params) -> ParamBlock {
    let mut block = [[0.0; 4]; 4];
    match generator {
        Generator::Noise => {
            block[0] = [
                number(params, "scale", 4.0).max(0.01),
                number(params, "speed", 0.5),
                number(params, "contrast", 1.0),
                0.0,
            ];
            block[1] = color(params, "color", "#ffffff");
        }
        Generator::Plasma => {
            block[0] = [
                number(params, "scale", 2.0).max(0.01),
                number(params, "speed", 1.0),
                0.0,
                0.0,
            ];
            block[1] = color(params, "colorA", "#ff2d95");
            block[2] = color(params, "colorB", "#2d6bff");
        }
        Generator::Lines => {
            block[0] = [
                number(params, "count", 24.0).max(1.0),
                number(params, "width", 0.2).clamp(0.0, 1.0),
                number(params, "angle", 0.0).to_radians(),
                number(params, "speed", 0.5),
            ];
            block[1] = color(params, "color", "#ffffff");
        }
    }
    block
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(json: serde_json::Value) -> Params {
        serde_json::from_value(json).expect("params")
    }

    #[test]
    fn effect_defaults_follow_the_catalog() {
        let empty = Params::new();
        let color_block = effect_params(EffectKind::Color, &empty);
        assert_eq!(color_block[0], [0.0, 1.0, 1.0, 0.0]);
        assert_eq!(color_block[1], [1.0, 1.0, 1.0, 0.0]);
        assert_eq!(effect_params(EffectKind::Blur, &empty)[0][0], 8.0);
        let key = effect_params(EffectKind::Key, &empty);
        assert_eq!(key[0], [0.0, 0.4, 0.1, 0.0]);
        assert_eq!(key[1], [0.0, 1.0, 0.0, 1.0]);
        assert_eq!(
            effect_params(EffectKind::Transform, &empty)[0],
            [1.0, 0.0, 0.0, 0.0]
        );
        assert_eq!(
            effect_params(EffectKind::Kaleidoscope, &empty)[0],
            [6.0, 0.0, 0.5, 0.5]
        );
        let feedback = effect_params(EffectKind::Feedback, &empty)[0];
        assert!((feedback[0] - 0.8).abs() < 1e-6 && (feedback[1] - 1.02).abs() < 1e-6);
    }

    #[test]
    fn reads_numbers_colours_booleans_and_enums() {
        let key = effect_params(
            EffectKind::Key,
            &params(
                serde_json::json!({ "mode": "luma", "keyColor": "#0000ff", "invert": true, "threshold": 0.2 }),
            ),
        );
        assert_eq!(key[0], [1.0, 0.2, 0.1, 1.0]);
        assert_eq!(key[1], [0.0, 0.0, 1.0, 1.0]);
        let transform = effect_params(
            EffectKind::Transform,
            &params(serde_json::json!({ "rotate": 180, "mirrorY": true })),
        );
        assert!((transform[0][3] - std::f32::consts::PI).abs() < 1e-5);
        assert_eq!(transform[1], [0.0, 1.0, 0.0, 0.0]);
        // Wrong types fall back to the default.
        let blur = effect_params(
            EffectKind::Blur,
            &params(serde_json::json!({ "radius": "big" })),
        );
        assert_eq!(blur[0][0], 8.0);
    }

    #[test]
    fn colours_are_linear_light() {
        let grey = linear_color("#808080").expect("grey");
        assert!((grey[0] - 0.2158).abs() < 1e-3);
        assert_eq!(linear_color("#ffffff80").expect("white")[3], 128.0 / 255.0);
        assert!(linear_color("nope").is_none());
    }

    #[test]
    fn generator_params_follow_the_shader_catalog() {
        assert_eq!(Generator::parse("plasma"), Some(Generator::Plasma));
        assert_eq!(Generator::parse("unknown"), None);
        let plasma = generator_params(Generator::Plasma, &Params::new());
        assert_eq!(plasma[0][..2], [2.0, 1.0]);
        assert!((plasma[1][0] - 1.0).abs() < 1e-6);
        let lines = generator_params(
            Generator::Lines,
            &params(serde_json::json!({ "count": 10, "width": 0.5, "angle": 90 })),
        );
        assert_eq!(lines[0][0], 10.0);
        assert_eq!(lines[0][1], 0.5);
        assert!((lines[0][2] - std::f32::consts::FRAC_PI_2).abs() < 1e-5);
        let noise = generator_params(Generator::Noise, &Params::new());
        assert_eq!(noise[0][..3], [4.0, 0.5, 1.0]);
    }
}
