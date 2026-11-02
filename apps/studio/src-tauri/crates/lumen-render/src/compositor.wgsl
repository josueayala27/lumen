// Composition passes: source normalization, generators, layer blending, effects, master and
// slide transitions. Every texture holds premultiplied linear RGBA. Formulas match
// `mapping.rs` and `effects.rs`.
//
// Shared header for single-input passes:
//   p[0] = (code, time seconds, aspect = width / height, extra)
//   p[1] = (1 / width, 1 / height, width, height) of the target
//   p[2..] = pass parameters

struct Pass {
    p: array<vec4<f32>, 32>,
};

@group(0) @binding(0) var t0: texture_2d<f32>;
@group(0) @binding(1) var t1: texture_2d<f32>;
@group(0) @binding(2) var t2: texture_2d<f32>;
@group(0) @binding(3) var t3: texture_2d<f32>;
@group(0) @binding(4) var t4: texture_2d<f32>;
@group(0) @binding(5) var linear_sampler: sampler;
@group(0) @binding(6) var<uniform> u: Pass;

struct VsOut {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

const PI: f32 = 3.14159265;
const TAU: f32 = 6.28318531;
const LUMA: vec3<f32> = vec3<f32>(0.2126, 0.7152, 0.0722);

@vertex
fn vs_full(@builtin(vertex_index) index: u32) -> VsOut {
    var positions = array<vec2<f32>, 3>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(3.0, -1.0),
        vec2<f32>(-1.0, 3.0),
    );
    var uvs = array<vec2<f32>, 3>(
        vec2<f32>(0.0, 1.0),
        vec2<f32>(2.0, 1.0),
        vec2<f32>(0.0, -1.0),
    );
    var out: VsOut;
    out.position = vec4<f32>(positions[index], 0.0, 1.0);
    out.uv = uvs[index];
    return out;
}

fn sample0(uv: vec2<f32>) -> vec4<f32> {
    return textureSampleLevel(t0, linear_sampler, uv, 0.0);
}

fn inside(uv: vec2<f32>) -> bool {
    return uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0;
}

fn sample0_or_clear(uv: vec2<f32>) -> vec4<f32> {
    if (!inside(uv)) {
        return vec4<f32>(0.0);
    }
    return sample0(uv);
}

fn unpremultiply(color: vec4<f32>) -> vec3<f32> {
    return color.rgb / max(color.a, 0.00001);
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

fn rotate(point: vec2<f32>, angle: f32) -> vec2<f32> {
    let s = sin(angle);
    let c = cos(angle);
    return vec2<f32>(point.x * c - point.y * s, point.x * s + point.y * c);
}

// --- Sources -----------------------------------------------------------------

// van Waveren and Castaño, "Real-Time YCoCg-DXT Compression" (2007): Co, Cg, scale, Y in RGBA.
fn ycocg_to_linear_rgb(texel: vec4<f32>) -> vec3<f32> {
    let offset = 128.0 / 255.0;
    let scale = texel.z * (255.0 / 8.0) + 1.0;
    let co = (texel.x - offset) / scale;
    let cg = (texel.y - offset) / scale;
    let y = texel.w;
    let rgb = clamp(vec3<f32>(y + co - cg, y + cg, y - co - cg), vec3<f32>(0.0), vec3<f32>(1.0));
    return srgb_to_linear(rgb);
}

// Normalizes a decoded video or image texture. p[0].x: 0 straight alpha, 1 opaque,
// 2 premultiplied, 3 scaled YCoCg. p[2].xy scales UVs to hide block padding.
@fragment
fn fs_convert(input: VsOut) -> @location(0) vec4<f32> {
    let texel = sample0(input.uv * u.p[2].xy);
    let mode = u.p[0].x;
    if (mode > 2.5) {
        return vec4<f32>(ycocg_to_linear_rgb(texel), 1.0);
    }
    if (mode > 1.5) {
        return texel;
    }
    if (mode > 0.5) {
        return vec4<f32>(texel.rgb, 1.0);
    }
    return vec4<f32>(texel.rgb * texel.a, texel.a);
}

fn hash(point: vec2<f32>) -> f32 {
    return fract(sin(dot(point, vec2<f32>(127.1, 311.7))) * 43758.5453);
}

fn value_noise(point: vec2<f32>) -> f32 {
    let cell = floor(point);
    let f = fract(point);
    let w = f * f * (3.0 - 2.0 * f);
    let a = hash(cell);
    let b = hash(cell + vec2<f32>(1.0, 0.0));
    let c = hash(cell + vec2<f32>(0.0, 1.0));
    let d = hash(cell + vec2<f32>(1.0, 1.0));
    return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}

fn fbm(point: vec2<f32>) -> f32 {
    var total = 0.0;
    var amplitude = 0.5;
    var p = point;
    for (var octave = 0; octave < 5; octave = octave + 1) {
        total = total + amplitude * value_noise(p);
        p = p * 2.03 + vec2<f32>(17.0, 31.0);
        amplitude = amplitude * 0.5;
    }
    return total / 0.96875;
}

fn premultiply(color: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(color.rgb * color.a, color.a);
}

fn srgb_color(color: vec4<f32>) -> vec4<f32> {
    return vec4<f32>(srgb_to_linear(color.rgb), color.a);
}

// Gradient stops: p[2] = (count, angle radians), p[3..4] = positions, p[5..12] = sRGB colours
// interpolated in sRGB like CSS.
fn gradient_at(t: f32) -> vec4<f32> {
    let count = i32(u.p[2].x);
    var color = u.p[5];
    var previous_at = u.p[3].x;
    for (var index = 1; index < 8; index = index + 1) {
        if (index >= count) {
            break;
        }
        let at = u.p[3 + index / 4][index % 4];
        let stop = u.p[5 + index];
        if (t >= at) {
            color = stop;
        } else {
            let span = max(at - previous_at, 0.00001);
            let previous = u.p[5 + index - 1];
            if (t > previous_at) {
                color = mix(previous, stop, clamp((t - previous_at) / span, 0.0, 1.0));
            }
            break;
        }
        previous_at = at;
    }
    return color;
}

// Generators. p[0].x: 0 solid, 1 linear gradient, 2 radial gradient, 3 noise, 4 plasma, 5 lines.
@fragment
fn fs_generator(input: VsOut) -> @location(0) vec4<f32> {
    let kind = u32(u.p[0].x + 0.5);
    let time = u.p[0].y;
    let aspect = u.p[0].z;
    let uv = input.uv;
    let centred = (uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0);
    switch kind {
        case 0u: {
            return premultiply(u.p[2]);
        }
        case 1u: {
            // CSS angle: 0 points up, clockwise.
            let angle = u.p[2].y;
            let direction = vec2<f32>(sin(angle), -cos(angle));
            let length = abs(aspect * sin(angle)) + abs(cos(angle));
            let t = dot(centred, direction) / max(length, 0.00001) + 0.5;
            return premultiply(srgb_color(gradient_at(clamp(t, 0.0, 1.0))));
        }
        case 2u: {
            let corner = 0.5 * length(vec2<f32>(aspect, 1.0));
            return premultiply(srgb_color(gradient_at(clamp(length(centred) / corner, 0.0, 1.0))));
        }
        case 3u: {
            let scale = u.p[2].x;
            let speed = u.p[2].y;
            let contrast = u.p[2].z;
            let drift = vec2<f32>(time * speed, time * speed * 0.7);
            let v = clamp((fbm(centred * scale + drift) - 0.5) * contrast + 0.5, 0.0, 1.0);
            return vec4<f32>(u.p[3].rgb * v, 1.0);
        }
        case 4u: {
            let scale = u.p[2].x;
            let t = time * u.p[2].y;
            let p = centred * scale * 3.0;
            var v = sin(p.x + t);
            v = v + sin((p.y + t) * 0.5);
            v = v + sin((p.x + p.y + t) * 0.5);
            let c = p + vec2<f32>(sin(t * 0.33) * 2.0, cos(t * 0.5) * 2.0);
            v = v + sin(sqrt(dot(c, c) + 1.0) + t);
            let mixer = 0.5 + 0.5 * sin(v * PI * 0.5);
            return vec4<f32>(mix(u.p[3].rgb, u.p[4].rgb, mixer), 1.0);
        }
        case 5u: {
            let count = u.p[2].x;
            let width = u.p[2].y;
            let angle = u.p[2].z;
            let speed = u.p[2].w;
            let along = rotate(centred, -angle).x / max(aspect, 1.0) + 0.5;
            let stripe = fract(along * count + time * speed);
            let edge = count * u.p[1].x * 1.5;
            let on = 1.0 - smoothstep(width - edge, width + edge, stripe);
            return vec4<f32>(u.p[3].rgb * on, on);
        }
        default: {
            return vec4<f32>(0.0);
        }
    }
}

// --- Layers ------------------------------------------------------------------
//
// p[0] = (blend, opacity, mix B, sample mode: 0 from sources A/B, 1 canvas-space t1)
// p[1] = layer box (x, y, w, h) normalized canvas
// p[2] = (rotation radians, anchor x, anchor y, canvas aspect)
// p[3] = UV rect A (u0, v0, u1, v1); p[4] = UV rect B
// p[5] = (discard A, discard B, mask kind: 0 none, 1 rect, 2 polygon, 3 image, mask invert)
// p[6] = rect mask (x, y, w, h); p[7] = (radius, feather, polygon count, has layer below)
// p[8..31] = polygon points, two per vec4
// t0 = canvas so far, t1 = source A or canvas-space layer, t2 = source B, t3 = mask image,
// t4 = canvas before the layer below (alpha matte).
// Blend codes: 0 normal, 1 add, 2 screen, 3 multiply, 4 overlay, 5 difference, 6 alpha,
// 99 place (writes the layer alone for its effects chain).

fn layer_local(uv: vec2<f32>) -> vec2<f32> {
    let box = u.p[1];
    let aspect = u.p[2].w;
    let pivot = box.xy + u.p[2].yz * box.zw;
    let d = (uv - pivot) * vec2<f32>(aspect, 1.0);
    let r = rotate(d, -u.p[2].x);
    let back = pivot + vec2<f32>(r.x / aspect, r.y);
    let size = select(box.zw, vec2<f32>(0.000001), abs(box.zw) < vec2<f32>(0.000001));
    return (back - box.xy) / size;
}

fn sample_rect(texture: texture_2d<f32>, rect: vec4<f32>, local: vec2<f32>, discard_outside: f32) -> vec4<f32> {
    let uv = mix(rect.xy, rect.zw, local);
    if (discard_outside > 0.5 && !inside(uv)) {
        return vec4<f32>(0.0);
    }
    return textureSampleLevel(texture, linear_sampler, uv, 0.0);
}

fn layer_sample(uv: vec2<f32>, local: vec2<f32>) -> vec4<f32> {
    if (u.p[0].w > 0.5) {
        return textureSampleLevel(t1, linear_sampler, uv, 0.0);
    }
    if (!inside(local)) {
        return vec4<f32>(0.0);
    }
    let a = sample_rect(t1, u.p[3], local, u.p[5].x);
    let b = sample_rect(t2, u.p[4], local, u.p[5].y);
    return mix(a, b, u.p[0].z);
}

fn rounded_box(point: vec2<f32>, half: vec2<f32>, radius: f32) -> f32 {
    let r = clamp(radius, 0.0, min(half.x, half.y));
    let q = abs(point) - half + vec2<f32>(r);
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

fn polygon_point(index: i32) -> vec2<f32> {
    let packed = u.p[8 + index / 2];
    if (index % 2 == 0) {
        return packed.xy;
    }
    return packed.zw;
}

// Signed distance to a polygon in `scale`d space: negative inside.
fn polygon_distance(point: vec2<f32>, count: i32, scale: vec2<f32>) -> f32 {
    let p = point * scale;
    var distance = 1e9;
    var inside_sign = 1.0;
    var j = count - 1;
    for (var i = 0; i < count; i = i + 1) {
        let a = polygon_point(i) * scale;
        let b = polygon_point(j) * scale;
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

fn feathered(distance: f32, feather: f32) -> f32 {
    return clamp(0.5 - distance / max(feather, 0.0015), 0.0, 1.0);
}

fn layer_mask(local: vec2<f32>) -> f32 {
    let kind = u32(u.p[5].z + 0.5);
    if (kind == 0u) {
        return 1.0;
    }
    // Distances in units of the layer height, so radius and feather stay round.
    let box_aspect = abs(u.p[1].z * u.p[2].w) / max(abs(u.p[1].w), 0.000001);
    let scale = vec2<f32>(box_aspect, 1.0);
    var m = 1.0;
    if (kind == 1u) {
        let rect = u.p[6];
        let centre = (rect.xy + rect.zw * 0.5) * scale;
        let d = rounded_box(local * scale - centre, rect.zw * 0.5 * scale, u.p[7].x);
        m = feathered(d, u.p[7].y);
    } else if (kind == 2u) {
        let count = i32(u.p[7].z);
        if (count >= 3) {
            m = feathered(polygon_distance(local, count, scale), u.p[7].y);
        }
    } else {
        if (inside(local)) {
            let texel = textureSampleLevel(t3, linear_sampler, local, 0.0);
            m = clamp(dot(texel.rgb, LUMA), 0.0, 1.0);
        } else {
            m = 0.0;
        }
    }
    if (u.p[5].w > 0.5) {
        m = 1.0 - m;
    }
    return m;
}

fn blend_channel(mode: u32, cb: vec3<f32>, cs: vec3<f32>) -> vec3<f32> {
    switch mode {
        case 2u: {
            return cb + cs - cb * cs;
        }
        case 3u: {
            return cb * cs;
        }
        case 4u: {
            let low = 2.0 * cb * cs;
            let high = vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - cb) * (vec3<f32>(1.0) - cs);
            return select(high, low, cb <= vec3<f32>(0.5));
        }
        case 5u: {
            return abs(cb - cs);
        }
        default: {
            return cs;
        }
    }
}

@fragment
fn fs_layer(input: VsOut) -> @location(0) vec4<f32> {
    let uv = input.uv;
    let mode = u32(u.p[0].x + 0.5);
    let local = layer_local(uv);
    let layer = layer_sample(uv, local);
    if (mode == 99u) {
        return layer;
    }
    let backdrop = sample0(uv);
    let opacity = clamp(u.p[0].y, 0.0, 1.0) * layer_mask(local);
    if (mode == 6u) {
        if (u.p[7].w < 0.5) {
            return backdrop;
        }
        let under = textureSampleLevel(t4, linear_sampler, uv, 0.0);
        let matte = 1.0 - opacity * (1.0 - clamp(layer.a, 0.0, 1.0));
        return mix(under, backdrop, matte);
    }
    let s = layer * opacity;
    let b = backdrop;
    if (mode == 0u) {
        return s + b * (1.0 - s.a);
    }
    let alpha = s.a + b.a * (1.0 - s.a);
    if (mode == 1u) {
        return vec4<f32>(s.rgb + b.rgb, alpha);
    }
    let cs = unpremultiply(s);
    let cb = unpremultiply(b);
    let mixed = blend_channel(mode, cb, cs);
    let rgb = s.rgb * (1.0 - b.a) + b.rgb * (1.0 - s.a) + s.a * b.a * mixed;
    return vec4<f32>(rgb, alpha);
}

// --- Effects -----------------------------------------------------------------

fn hue_rotate(color: vec3<f32>, angle: f32) -> vec3<f32> {
    // Rodrigues rotation around the grey axis.
    let k = vec3<f32>(0.57735027);
    let c = cos(angle);
    let s = sin(angle);
    return color * c + cross(k, color) * s + k * dot(k, color) * (1.0 - c);
}

// p[2] = (brightness, contrast, saturation, hue radians), p[3] = (tint rgb, tint amount).
// Adjustments run on sRGB-encoded values so they feel like the editor's sliders.
@fragment
fn fs_color(input: VsOut) -> @location(0) vec4<f32> {
    let texel = sample0(input.uv);
    if (texel.a <= 0.0) {
        return vec4<f32>(0.0);
    }
    var c = linear_to_srgb(unpremultiply(texel));
    c = c + vec3<f32>(u.p[2].x);
    c = (c - vec3<f32>(0.5)) * u.p[2].y + vec3<f32>(0.5);
    let luma = dot(c, LUMA);
    c = mix(vec3<f32>(luma), c, u.p[2].z);
    c = hue_rotate(c, u.p[2].w);
    let tint = linear_to_srgb(u.p[3].rgb);
    c = mix(c, vec3<f32>(dot(c, LUMA)) * tint, clamp(u.p[3].w, 0.0, 1.0));
    let rgb = srgb_to_linear(clamp(c, vec3<f32>(0.0), vec3<f32>(1.0)));
    return vec4<f32>(rgb * texel.a, texel.a);
}

// Separable Gaussian. p[2].x = radius in target pixels, p[0].w: 0 horizontal, 1 vertical.
@fragment
fn fs_blur(input: VsOut) -> @location(0) vec4<f32> {
    let radius = u.p[2].x;
    if (radius < 0.5) {
        return sample0(input.uv);
    }
    let direction = select(vec2<f32>(u.p[1].x, 0.0), vec2<f32>(0.0, u.p[1].y), u.p[0].w > 0.5);
    let taps = min(ceil(radius), 32.0);
    let step = radius / taps;
    let sigma = max(radius * 0.5, 0.5);
    var total = sample0(input.uv);
    var weight = 1.0;
    for (var i = 1.0; i <= taps; i = i + 1.0) {
        let offset = i * step;
        let w = exp(-0.5 * offset * offset / (sigma * sigma));
        total = total + w * (sample0(input.uv + direction * offset) + sample0(input.uv - direction * offset));
        weight = weight + 2.0 * w;
    }
    return total / weight;
}

fn to_cbcr(rgb: vec3<f32>) -> vec2<f32> {
    let y = dot(rgb, vec3<f32>(0.299, 0.587, 0.114));
    return vec2<f32>((rgb.b - y) * 0.564, (rgb.r - y) * 0.713);
}

// p[2] = (mode: 0 chroma, 1 luma, threshold, softness, invert), p[3] = key colour (linear).
@fragment
fn fs_key(input: VsOut) -> @location(0) vec4<f32> {
    let texel = sample0(input.uv);
    if (texel.a <= 0.0) {
        return vec4<f32>(0.0);
    }
    let c = linear_to_srgb(unpremultiply(texel));
    let threshold = u.p[2].y;
    let softness = max(u.p[2].z, 0.0001);
    var keep = 1.0;
    if (u.p[2].x > 0.5) {
        keep = smoothstep(threshold, threshold + softness, dot(c, LUMA));
    } else {
        let key = linear_to_srgb(u.p[3].rgb);
        // Normalized so a pure key colour sits about 1 away from grey.
        let distance = length(to_cbcr(c) - to_cbcr(key)) / max(length(to_cbcr(key)), 0.1) * 0.5;
        keep = smoothstep(threshold * 0.5, threshold * 0.5 + softness, distance);
    }
    if (u.p[2].w > 0.5) {
        keep = 1.0 - keep;
    }
    return texel * keep;
}

// p[2] = (scale, offset x, offset y, rotate radians), p[3] = (mirror x, mirror y).
@fragment
fn fs_transform(input: VsOut) -> @location(0) vec4<f32> {
    let aspect = u.p[0].z;
    let scale = max(abs(u.p[2].x), 0.0001) * sign(u.p[2].x + 0.0000001);
    var p = (input.uv - vec2<f32>(0.5) - u.p[2].yz) * vec2<f32>(aspect, 1.0);
    p = rotate(p, -u.p[2].w) / scale;
    var uv = p / vec2<f32>(aspect, 1.0) + vec2<f32>(0.5);
    if (u.p[3].x > 0.5) {
        uv.x = 1.0 - uv.x;
    }
    if (u.p[3].y > 0.5) {
        uv.y = 1.0 - uv.y;
    }
    return sample0_or_clear(uv);
}

// p[2] = (segments, rotate radians, centre x, centre y).
@fragment
fn fs_kaleidoscope(input: VsOut) -> @location(0) vec4<f32> {
    let aspect = u.p[0].z;
    let centre = u.p[2].zw;
    let p = (input.uv - centre) * vec2<f32>(aspect, 1.0);
    let radius = length(p);
    let segment = TAU / max(u.p[2].x, 2.0);
    var angle = atan2(p.y, p.x) - u.p[2].y;
    angle = angle - segment * floor(angle / segment);
    if (angle > segment * 0.5) {
        angle = segment - angle;
    }
    angle = angle + u.p[2].y;
    let uv = centre + vec2<f32>(cos(angle), sin(angle)) * radius / vec2<f32>(aspect, 1.0);
    return sample0(clamp(uv, vec2<f32>(0.0), vec2<f32>(1.0)));
}

// p[2] = (amount, zoom, rotate radians). t1 = this effect's previous output.
@fragment
fn fs_feedback(input: VsOut) -> @location(0) vec4<f32> {
    let aspect = u.p[0].z;
    let current = sample0(input.uv);
    var p = (input.uv - vec2<f32>(0.5)) * vec2<f32>(aspect, 1.0);
    p = rotate(p, -u.p[2].z) / max(u.p[2].y, 0.01);
    let uv = p / vec2<f32>(aspect, 1.0) + vec2<f32>(0.5);
    var previous = vec4<f32>(0.0);
    if (inside(uv)) {
        previous = textureSampleLevel(t1, linear_sampler, uv, 0.0);
    }
    return current + previous * u.p[2].x * (1.0 - current.a);
}

// p[2].x = opacity.
@fragment
fn fs_opacity(input: VsOut) -> @location(0) vec4<f32> {
    return sample0(input.uv) * clamp(u.p[2].x, 0.0, 1.0);
}

// Slide transition from t0 to t1. p[2] = (progress, kind: 0 cut, 1 fade, 2 dissolve, 3 slide, 4 zoom).
@fragment
fn fs_slide_transition(input: VsOut) -> @location(0) vec4<f32> {
    let uv = input.uv;
    let progress = clamp(u.p[2].x, 0.0, 1.0);
    let kind = u32(u.p[2].y + 0.5);
    let from_color = sample0(uv);
    let to_color = textureSampleLevel(t1, linear_sampler, uv, 0.0);
    switch kind {
        case 1u: {
            return from_color * (1.0 - progress) + to_color * progress;
        }
        case 2u: {
            let noise = fract(sin(dot(uv, vec2<f32>(12.9898, 78.233))) * 43758.5453);
            return select(from_color, to_color, noise < progress);
        }
        case 3u: {
            let edge = 1.0 - progress;
            if (uv.x < edge) {
                return textureSampleLevel(t0, linear_sampler, vec2<f32>(uv.x + progress, uv.y), 0.0);
            }
            return textureSampleLevel(t1, linear_sampler, vec2<f32>(uv.x - edge, uv.y), 0.0);
        }
        case 4u: {
            let scale = mix(0.8, 1.0, progress);
            let zoomed = (uv - vec2<f32>(0.5)) / scale + vec2<f32>(0.5);
            var zoom_color = vec4<f32>(0.0);
            if (inside(zoomed)) {
                zoom_color = textureSampleLevel(t1, linear_sampler, zoomed, 0.0);
            }
            return from_color * (1.0 - progress) + zoom_color * progress;
        }
        default: {
            return to_color;
        }
    }
}
