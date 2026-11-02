// Per-screen stage: region crop, background, warp (corner pin and mesh as geometry), edge blend,
// output masks, colour, test pattern and blackout. One pass from the canvas to the output.
// Formulas match `mapping.rs`.
//
// s.p[0] = region (x, y, w, h) on the canvas
// s.p[1] = background (linear rgb, 1)
// s.p[2] = edge-blend widths (left, right, top, bottom)
// s.p[3] = edge-blend gammas; s.p[4] = edge-blend powers
// s.p[5] = (brightness, contrast, gamma, 0); s.p[6] = (red, green, blue, 0)
// s.p[7] = (test pattern: 0 none, 1 grid, 2 bars, 3 identify, blackout, mask count, identify hue)
// s.p[8] = (output width, output height, 0, 0)
// s.p[9 + 10 * i ..] = output mask i: header (kind 1 rect / 2 polygon, feather, invert, points),
//                      rect (x, y, w, h), (radius, 0, 0, 0), then 7 vec4 of polygon points.

struct Screen {
    p: array<vec4<f32>, 64>,
};

@group(0) @binding(0) var canvas: texture_2d<f32>;
@group(0) @binding(1) var unused1: texture_2d<f32>;
@group(0) @binding(2) var unused2: texture_2d<f32>;
@group(0) @binding(3) var unused3: texture_2d<f32>;
@group(0) @binding(4) var unused4: texture_2d<f32>;
@group(0) @binding(5) var linear_sampler: sampler;
@group(0) @binding(6) var<uniform> s: Screen;

struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
};

struct VsOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

const MAX_MASKS: i32 = 4;
const MASK_STRIDE: i32 = 10;

@vertex
fn vs_screen(input: VertexInput) -> VsOut {
    var out: VsOut;
    out.position = vec4<f32>(input.position.x * 2.0 - 1.0, 1.0 - input.position.y * 2.0, 0.0, 1.0);
    out.uv = input.uv;
    return out;
}

fn srgb_to_linear(value: vec3<f32>) -> vec3<f32> {
    let low = value / 12.92;
    let high = pow((max(value, vec3<f32>(0.0)) + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(high, low, value <= vec3<f32>(0.04045));
}

fn linear_to_srgb(value: vec3<f32>) -> vec3<f32> {
    let v = max(value, vec3<f32>(0.0));
    let low = v * 12.92;
    let high = 1.055 * pow(v, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
    return select(high, low, v <= vec3<f32>(0.0031308));
}

fn ramp(x: f32, gamma: f32, power: f32) -> f32 {
    let t = clamp(x, 0.0, 1.0);
    var curve = 0.0;
    if (t < 0.5) {
        curve = 0.5 * pow(2.0 * t, max(power, 0.001));
    } else {
        curve = 1.0 - 0.5 * pow(2.0 * (1.0 - t), max(power, 0.001));
    }
    return pow(curve, 2.2 / max(gamma, 0.001));
}

fn side(distance: f32, width: f32, gamma: f32, power: f32) -> f32 {
    if (width <= 0.0) {
        return 1.0;
    }
    return ramp(distance / width, gamma, power);
}

fn edge_blend(uv: vec2<f32>) -> f32 {
    let w = s.p[2];
    let g = s.p[3];
    let p = s.p[4];
    return side(uv.x, w.x, g.x, p.x) * side(1.0 - uv.x, w.y, g.y, p.y)
        * side(uv.y, w.z, g.z, p.z) * side(1.0 - uv.y, w.w, g.w, p.w);
}

fn rounded_box(point: vec2<f32>, half: vec2<f32>, radius: f32) -> f32 {
    let r = clamp(radius, 0.0, min(half.x, half.y));
    let q = abs(point) - half + vec2<f32>(r);
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn mask_point(base: i32, index: i32) -> vec2<f32> {
    let packed = s.p[base + 3 + index / 2];
    if (index % 2 == 0) {
        return packed.xy;
    }
    return packed.zw;
}

fn polygon_distance(base: i32, point: vec2<f32>, count: i32, scale: vec2<f32>) -> f32 {
    let p = point * scale;
    var distance = 1e9;
    var inside_sign = 1.0;
    var j = count - 1;
    for (var i = 0; i < count; i = i + 1) {
        let a = mask_point(base, i) * scale;
        let b = mask_point(base, j) * scale;
        let e = b - a;
        let w = p - a;
        let projected = w - e * clamp(dot(w, e) / max(dot(e, e), 1e-12), 0.0, 1.0);
        distance = min(distance, dot(projected, projected));
        let c1 = p.y >= a.y;
        let c2 = p.y < b.y;
        let c3 = e.x * w.y > e.y * w.x;
        if ((c1 && c2 && c3) || (!c1 && !c2 && !c3)) {
            inside_sign = -inside_sign;
        }
        j = i;
    }
    return inside_sign * sqrt(distance);
}

// Masks hide parts of the output: 1 keeps the pixel.
fn output_masks(out_uv: vec2<f32>) -> f32 {
    let aspect = s.p[8].x / max(s.p[8].y, 1.0);
    let scale = vec2<f32>(aspect, 1.0);
    let count = min(i32(s.p[7].z), MAX_MASKS);
    var keep = 1.0;
    for (var index = 0; index < count; index = index + 1) {
        let base = 9 + index * MASK_STRIDE;
        let header = s.p[base];
        let feather = max(header.y, 0.0015);
        var d = 1e9;
        if (header.x < 1.5) {
            let rect = s.p[base + 1];
            let centre = (rect.xy + rect.zw * 0.5) * scale;
            d = rounded_box(out_uv * scale - centre, rect.zw * 0.5 * scale, s.p[base + 2].x);
        } else if (header.w >= 3.0) {
            d = polygon_distance(base, out_uv, i32(header.w), scale);
        }
        var inside = clamp(0.5 - d / feather, 0.0, 1.0);
        if (header.z > 0.5) {
            inside = 1.0 - inside;
        }
        // A mask hides what it covers.
        keep = keep * (1.0 - inside);
    }
    return keep;
}

fn hue_color(hue: f32) -> vec3<f32> {
    let k = vec3<f32>(0.0, 2.0 / 3.0, 1.0 / 3.0);
    return clamp(abs(fract(vec3<f32>(hue) + k) * 6.0 - vec3<f32>(3.0)) - vec3<f32>(1.0), vec3<f32>(0.0), vec3<f32>(1.0));
}

// Test patterns in output space, sRGB-encoded.
fn test_pattern(kind: u32, uv: vec2<f32>) -> vec3<f32> {
    let size = s.p[8].xy;
    let px = uv * size;
    if (kind == 1u) {
        let cell = size.y / 9.0;
        let grid = fract(px / cell + vec2<f32>(0.5 / cell));
        let line = min(grid.x, grid.y) * cell < 1.5;
        let border = px.x < 3.0 || px.y < 3.0 || px.x > size.x - 3.0 || px.y > size.y - 3.0;
        let centre = abs(length((uv - vec2<f32>(0.5)) * vec2<f32>(size.x / size.y, 1.0)) - 0.4) * size.y < 1.5;
        let cross = abs(px.x - size.x * 0.5) < 1.5 || abs(px.y - size.y * 0.5) < 1.5;
        if (border) {
            return vec3<f32>(1.0, 0.2, 0.2);
        }
        if (line || centre || cross) {
            return vec3<f32>(1.0);
        }
        return vec3<f32>(0.08);
    }
    if (kind == 2u) {
        var bars = array<vec3<f32>, 7>(
            vec3<f32>(0.75, 0.75, 0.75),
            vec3<f32>(0.75, 0.75, 0.0),
            vec3<f32>(0.0, 0.75, 0.75),
            vec3<f32>(0.0, 0.75, 0.0),
            vec3<f32>(0.75, 0.0, 0.75),
            vec3<f32>(0.75, 0.0, 0.0),
            vec3<f32>(0.0, 0.0, 0.75),
        );
        if (uv.y > 0.75) {
            return vec3<f32>(floor(uv.x * 8.0) / 7.0);
        }
        return bars[min(i32(uv.x * 7.0), 6)];
    }
    let border = min(min(px.x, size.x - px.x), min(px.y, size.y - px.y)) < size.y * 0.03;
    let diagonal = abs(uv.x - uv.y) * size.x < 4.0 || abs(uv.x + uv.y - 1.0) * size.x < 4.0;
    if (border || diagonal) {
        return vec3<f32>(1.0);
    }
    return hue_color(s.p[7].w) * 0.6;
}

@fragment
fn fs_screen(input: VsOut) -> @location(0) vec4<f32> {
    let out_uv = input.position.xy / max(s.p[8].xy, vec2<f32>(1.0));
    if (s.p[7].y > 0.5) {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }
    let pattern = u32(s.p[7].x + 0.5);
    if (pattern > 0u) {
        return vec4<f32>(srgb_to_linear(test_pattern(pattern, out_uv)), 1.0);
    }
    let region = s.p[0];
    let canvas_uv = region.xy + input.uv * region.zw;
    var content = vec4<f32>(0.0);
    if (canvas_uv.x >= 0.0 && canvas_uv.x <= 1.0 && canvas_uv.y >= 0.0 && canvas_uv.y <= 1.0) {
        content = textureSampleLevel(canvas, linear_sampler, canvas_uv, 0.0);
    }
    var rgb = content.rgb + s.p[1].rgb * (1.0 - clamp(content.a, 0.0, 1.0));
    rgb = rgb * edge_blend(input.uv) * output_masks(out_uv);
    let color = s.p[5];
    var encoded = linear_to_srgb(rgb);
    encoded = (encoded - vec3<f32>(0.5)) * color.y + vec3<f32>(0.5) + vec3<f32>(color.x);
    encoded = pow(max(encoded, vec3<f32>(0.0)), vec3<f32>(1.0 / max(color.z, 0.001)));
    encoded = encoded * s.p[6].rgb;
    return vec4<f32>(srgb_to_linear(clamp(encoded, vec3<f32>(0.0), vec3<f32>(1.0))), 1.0);
}
