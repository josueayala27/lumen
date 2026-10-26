//! Color parsing and blending helpers shared by the clear pass, shapes and text.

/// Straight-alpha RGBA color.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ClearColor {
    pub r: f64,
    pub g: f64,
    pub b: f64,
    pub a: f64,
}

impl Default for ClearColor {
    fn default() -> Self {
        Self::BLACK
    }
}

impl ClearColor {
    pub const BLACK: Self = Self {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 1.0,
    };

    pub const TRANSPARENT: Self = Self {
        r: 0.0,
        g: 0.0,
        b: 0.0,
        a: 0.0,
    };

    pub fn from_rgba8(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self {
            r: f64::from(r) / 255.0,
            g: f64::from(g) / 255.0,
            b: f64::from(b) / 255.0,
            a: f64::from(a) / 255.0,
        }
    }

    /// Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa` and a small set of named colors.
    pub fn parse(value: &str) -> Option<Self> {
        let value = value.trim();
        if value.eq_ignore_ascii_case("black") {
            return Some(Self::BLACK);
        }
        if value.eq_ignore_ascii_case("white") {
            return Some(Self::from_rgba8(255, 255, 255, 255));
        }
        if value.eq_ignore_ascii_case("transparent") {
            return Some(Self::TRANSPARENT);
        }

        let hex = value.strip_prefix('#').unwrap_or(value);
        let expand = |digit: u8| {
            let value = (digit as char).to_digit(16)?;
            Some((value * 17) as u8)
        };
        let pair = |text: &str| u8::from_str_radix(text, 16).ok();

        let (r, g, b, a) = match hex.len() {
            3 => (
                expand(hex.as_bytes()[0])?,
                expand(hex.as_bytes()[1])?,
                expand(hex.as_bytes()[2])?,
                255,
            ),
            4 => (
                expand(hex.as_bytes()[0])?,
                expand(hex.as_bytes()[1])?,
                expand(hex.as_bytes()[2])?,
                expand(hex.as_bytes()[3])?,
            ),
            6 => (pair(&hex[0..2])?, pair(&hex[2..4])?, pair(&hex[4..6])?, 255),
            8 => (
                pair(&hex[0..2])?,
                pair(&hex[2..4])?,
                pair(&hex[4..6])?,
                pair(&hex[6..8])?,
            ),
            _ => return None,
        };

        Some(Self::from_rgba8(r, g, b, a))
    }

    /// Parses a contract color, falling back to opaque black.
    pub fn parse_or_black(value: &str) -> Self {
        Self::parse(value).unwrap_or(Self::BLACK)
    }

    pub fn with_alpha(self, alpha: f64) -> Self {
        Self {
            a: (self.a * alpha.clamp(0.0, 1.0)).clamp(0.0, 1.0),
            ..self
        }
    }

    pub fn to_rgba8(self) -> [u8; 4] {
        let to_byte = |channel: f64| (channel.clamp(0.0, 1.0) * 255.0).round() as u8;
        [
            to_byte(self.r),
            to_byte(self.g),
            to_byte(self.b),
            to_byte(self.a),
        ]
    }

    pub fn to_array(self) -> [f32; 4] {
        [self.r as f32, self.g as f32, self.b as f32, self.a as f32]
    }

    pub fn to_wgpu(self) -> wgpu::Color {
        wgpu::Color {
            r: self.r,
            g: self.g,
            b: self.b,
            a: self.a,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_hex_and_named_colors() {
        assert_eq!(
            ClearColor::parse("#ff8000"),
            Some(ClearColor::from_rgba8(255, 128, 0, 255))
        );
        assert_eq!(
            ClearColor::parse("#0f08"),
            Some(ClearColor::from_rgba8(0, 255, 0, 136))
        );
        assert_eq!(
            ClearColor::parse("white"),
            Some(ClearColor::from_rgba8(255, 255, 255, 255))
        );
        assert_eq!(ClearColor::parse("not-a-color"), None);
        assert_eq!(ClearColor::parse_or_black("nope"), ClearColor::BLACK);
    }

    #[test]
    fn multiplies_alpha_and_keeps_it_in_range() {
        let color = ClearColor::from_rgba8(10, 20, 30, 200);
        assert!((color.with_alpha(0.5).a - (200.0 / 255.0) * 0.5).abs() < 1e-9);
        assert_eq!(color.with_alpha(2.0).a, color.a);
        assert_eq!(color.with_alpha(-1.0).a, 0.0);
    }

    #[test]
    fn converts_to_bytes_and_arrays() {
        let color = ClearColor::from_rgba8(255, 128, 0, 255);
        assert_eq!(color.to_rgba8(), [255, 128, 0, 255]);
        assert_eq!(color.to_array(), [1.0, 128.0 / 255.0, 0.0, 1.0]);
    }
}
