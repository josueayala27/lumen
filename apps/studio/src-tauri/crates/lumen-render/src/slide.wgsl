struct VertexInput {
    @location(0) position: vec2<f32>,
    @location(1) uv: vec2<f32>,
    @location(2) color: vec4<f32>,
    @location(3) stroke_color: vec4<f32>,
    @location(4) local: vec2<f32>,
    @location(5) size: vec2<f32>,
    @location(6) params: vec4<f32>,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
    @location(1) color: vec4<f32>,
    @location(2) stroke_color: vec4<f32>,
    @location(3) local: vec2<f32>,
    @location(4) size: vec2<f32>,
    @location(5) params: vec4<f32>,
};

@vertex
fn vs_main(input: VertexInput) -> VertexOutput {
    var output: VertexOutput;
    output.position = vec4<f32>(input.position, 0.0, 1.0);
    output.uv = input.uv;
    output.color = input.color;
    output.stroke_color = input.stroke_color;
    output.local = input.local;
    output.size = input.size;
    output.params = input.params;
    return output;
}

@group(0) @binding(0) var source_texture: texture_2d<f32>;
@group(0) @binding(1) var source_sampler: sampler;

fn srgb_to_linear(value: vec3<f32>) -> vec3<f32> {
    let low = value / 12.92;
    let high = pow((value + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
    return select(high, low, value <= vec3<f32>(0.04045));
}

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

fn rounded_rect_distance(point: vec2<f32>, half: vec2<f32>, radius: f32) -> f32 {
    let r = clamp(radius, 0.0, min(half.x, half.y));
    let q = abs(point) - half + vec2<f32>(r);
    return length(max(q, vec2<f32>(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    if (input.params.z > 0.5) {
        if (input.uv.x < 0.0 || input.uv.x > 1.0 || input.uv.y < 0.0 || input.uv.y > 1.0) {
            discard;
        }
    }

    let texel = textureSample(source_texture, source_sampler, input.uv);
    var color = input.color;
    if (input.params.w > 3.5) {
        // Opaque video (Hap DXT1): ignore block transparency.
        color = color * vec4<f32>(texel.rgb, 1.0);
    } else if (input.params.w > 2.5) {
        // Scaled YCoCg (Hap Q), sampled from a linear texture.
        color = color * vec4<f32>(ycocg_to_linear_rgb(texel), 1.0);
    } else if (input.params.w > 1.5) {
        color.a = color.a * texel.a;
    } else if (input.params.w > 0.5) {
        color = color * texel;
    }

    let half_size = input.size * 0.5;
    let distance = rounded_rect_distance(input.local - half_size, half_size, input.params.x);
    let outer = clamp(0.5 - distance, 0.0, 1.0);
    if (input.params.y > 0.0) {
        let inner = clamp(0.5 - (distance + input.params.y), 0.0, 1.0);
        let band = clamp(outer - inner, 0.0, 1.0);
        let fill = color * inner;
        let stroke = input.stroke_color * band;
        let alpha = clamp(outer, 0.0, 1.0);
        if (alpha <= 0.0) {
            discard;
        }
        let rgb = (fill.rgb * fill.a + stroke.rgb * stroke.a) / max(alpha, 0.00001);
        return vec4<f32>(rgb, alpha);
    }

    color.a = color.a * outer;
    if (color.a <= 0.0) {
        discard;
    }
    return color;
}
