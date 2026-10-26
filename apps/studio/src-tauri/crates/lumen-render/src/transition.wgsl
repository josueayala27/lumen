struct Params {
    progress: f32,
    kind: u32,
    pad0: u32,
    pad1: u32,
};

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@group(0) @binding(0) var from_texture: texture_2d<f32>;
@group(0) @binding(1) var to_texture: texture_2d<f32>;
@group(0) @binding(2) var transition_sampler: sampler;
@group(0) @binding(3) var<uniform> params: Params;

@vertex
fn vs_main(@builtin(vertex_index) index: u32) -> VertexOutput {
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
    var output: VertexOutput;
    output.position = vec4<f32>(positions[index], 0.0, 1.0);
    output.uv = uvs[index];
    return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4<f32> {
    let uv = clamp(input.uv, vec2<f32>(0.0), vec2<f32>(1.0));
    let from_color = textureSample(from_texture, transition_sampler, uv);
    let to_color = textureSample(to_texture, transition_sampler, uv);
    let progress = clamp(params.progress, 0.0, 1.0);

    if (params.kind == 1u) {
        let black = vec4<f32>(0.0, 0.0, 0.0, 1.0);
        if (progress < 0.5) {
            return mix(from_color, black, progress * 2.0);
        }
        return mix(black, to_color, (progress - 0.5) * 2.0);
    }
    if (params.kind == 2u) {
        let noise = fract(sin(dot(uv, vec2<f32>(12.9898, 78.233))) * 43758.5453);
        if (noise < progress) {
            return to_color;
        }
        return from_color;
    }
    if (params.kind == 3u) {
        let edge = 1.0 - progress;
        if (uv.x < edge) {
            return from_color;
        }
        return textureSample(to_texture, transition_sampler, vec2<f32>(uv.x - edge, uv.y));
    }
    if (params.kind == 4u) {
        let scale = mix(0.8, 1.0, progress);
        let zoomed = (uv - vec2<f32>(0.5)) / scale + vec2<f32>(0.5);
        if (zoomed.x >= 0.0 && zoomed.x <= 1.0 && zoomed.y >= 0.0 && zoomed.y <= 1.0) {
            return textureSample(to_texture, transition_sampler, zoomed);
        }
        return from_color;
    }
    return to_color;
}
