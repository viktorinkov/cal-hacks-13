import { beatAt, palette, wheel, type RGB } from './show'

const VERT = `#version 300 es
in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`

// Everything is in device pixels with y pointing down, so positions from the DOM pass straight through.
const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2 uRes;
uniform float uTime;
uniform float uBeat;
uniform float uOn;
uniform float uSpot;
uniform float uKey;
uniform float uBoost;
uniform float uCalm;
uniform float uScale;
uniform float uHorizon;
uniform vec3 uFace;
uniform vec3 uPtr;
uniform vec3 uPal[4];
uniform vec4 uRip[12];
uniform vec3 uRipC[12];
uniform vec4 uFall;

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(11.7, 5.3);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  float W = uRes.x;
  float H = uRes.y;
  float S = uScale;
  float t = uTime;
  float moving = 1.0 - uCalm;
  vec2 uv = p / H;

  float h1 = fbm(uv * vec2(1.5, 2.3) + vec2(t * 0.018, -t * 0.03) * moving);
  float h2 = fbm(uv * 4.2 - vec2(t * 0.045, t * 0.012) * moving);
  float haze = 0.22 + 0.78 * h1 * (0.65 + 0.7 * h2);

  float ph = fract(uBeat);
  float env = exp(-ph * 5.0) * moving;
  float down = 1.0 - step(0.5, mod(floor(uBeat), 4.0));
  float pulse = 0.36 + 1.3 * env * (0.72 + 0.55 * down) + uBoost * 0.9;

  vec3 col = vec3(0.0);

  // Moving heads on a truss above the stage.
  for (int i = 0; i < 6; i++) {
    float fi = float(i);
    vec2 o = vec2(W * (0.08 + 0.168 * fi), -0.05 * H);
    float sweep = sin(t * 0.37 + fi * 1.9) * 0.36 + sin(t * 0.13 + fi * 0.7) * 0.16;
    float a = 1.5708 + (2.5 - fi) * 0.17 + sweep * moving;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 d = p - o;
    float along = dot(d, dir);
    float across = abs(d.x * dir.y - d.y * dir.x);
    float w = along * 0.075 + 7.0 * S;
    float q = across * across / (w * w);
    float reach = smoothstep(0.0, 30.0 * S, along) * smoothstep(H * 1.4, H * 0.1, along);
    float beam = exp(-q * 1.6) * reach;
    float core = exp(-q * 14.0) * reach;
    float alt = mod(fi, 2.0) < 0.5 ? 1.0 : 0.35 + 0.65 * step(0.5, mod(floor(uBeat), 2.0));
    col += uPal[i % 4] * (beam * (0.25 + 0.9 * haze) + core * 0.4) * pulse * alt * 0.95 * uOn;
  }

  // Uplights along the front of the stage, fanning out on the off-beats.
  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    vec2 o = vec2(W * (0.2 + 0.2 * fi), uHorizon + 0.02 * H);
    float a = -1.5708 + (fi - 1.5) * 0.34 + sin(t * 0.5 + fi * 2.3) * 0.22 * moving;
    vec2 dir = vec2(cos(a), sin(a));
    vec2 d = p - o;
    float along = dot(d, dir);
    float across = abs(d.x * dir.y - d.y * dir.x);
    float w = along * 0.05 + 4.0 * S;
    float q = across * across / (w * w);
    float beam = exp(-q * 2.0) * smoothstep(0.0, 20.0 * S, along) * smoothstep(H * 0.9, 0.0, along);
    float off = exp(-fract(uBeat + 0.5) * 6.0) * moving;
    col += uPal[(i + 2) % 4] * beam * (0.2 + 0.8 * haze) * (0.18 + 0.9 * off) * 0.7 * uOn;
  }

  // Wash of light along the back of the stage, and a flash through the haze on the downbeat.
  float wash = exp(-pow((p.y - uHorizon) / (0.12 * H), 2.0));
  col += uPal[1] * wash * haze * (0.05 + 0.3 * env * down) * uOn;
  col += vec3(0.9, 0.92, 1.0) * haze * haze * env * down * 0.14 * uOn;

  // The follow spot on the headliner.
  vec2 so = vec2(uFace.x + 0.05 * W, -0.5 * H);
  vec2 toF = uFace.xy - so;
  float dist = length(toF);
  vec2 sd = toF / dist;
  vec2 d2 = p - so;
  float al = dot(d2, sd);
  float ac = abs(d2.x * sd.y - d2.y * sd.x);
  float cr = uFace.z * 1.2 * (al / dist);
  float cone = smoothstep(cr, cr * 0.55, ac) * step(0.0, al) * smoothstep(dist * 1.7, dist * 0.95, al);
  float pool = exp(-pow(length(p - uFace.xy) / (uFace.z * 1.7), 2.0));
  vec3 warm = vec3(1.0, 0.93, 0.82);
  col += warm * uSpot * (cone * (0.06 + 0.17 * haze) + pool * 0.4);

  // A hand-held light that follows the pointer through the haze.
  vec2 pd = (p - uPtr.xy) / (S * 210.0);
  col += uPal[0] * uPtr.z * exp(-dot(pd, pd)) * (0.05 + 0.2 * haze) * (0.35 + 0.65 * uOn);

  // Ripples left by the pointer.
  vec3 rip = vec3(0.0);
  for (int k = 0; k < 12; k++) {
    vec4 r = uRip[k];
    float age = t - r.z;
    if (age < 0.0 || age > 2.6) continue;
    vec2 dd = (p - r.xy) * vec2(1.0, 1.6);
    float rad = (age * 340.0 + 8.0) * S * r.w;
    float wid = (14.0 + age * 34.0) * S * r.w;
    float x = (length(dd) - rad) / wid;
    rip += uRipC[k] * exp(-x * x) * exp(-age * 1.55);
  }
  col += rip * (0.08 + 0.3 * haze);

  // Someone falls.
  float fallAge = t - uFall.z;
  float fallOn = uFall.w * step(0.0, fallAge);
  float R = 118.0 * S;
  float fp = fract(fallAge);
  float sos = step(fp, 0.09) + step(0.18, fp) * step(fp, 0.27) + step(0.36, fp) * step(fp, 0.45);
  float alertOn = fallOn * (1.0 - step(3.0, fallAge));
  float guideOn = fallOn * smoothstep(1.0, 1.4, fallAge) * (1.0 - smoothstep(5.4, 6.4, fallAge));
  vec2 fd = (p - uFall.xy) * vec2(1.0, 2.0);
  float fr = length(fd);
  vec3 red = vec3(1.0, 0.1, 0.08);
  col += red * exp(-pow((fr - fallAge * 600.0 * S) / (26.0 * S), 2.0)) * exp(-fallAge * 1.5) * fallOn * 0.5;
  col += red * alertOn * sos * exp(-pow(fr / (R * 1.5), 2.0)) * 0.3;

  // The crowd: a field of bands in perspective.
  float hy = uHorizon;
  if (p.y > hy - 6.0 * S) {
    vec2 qp = p;
    vec2 fq = qp - uFall.xy;
    float frq = length(fq * vec2(1.0, 2.0));
    float back = 30.0 * S * fallOn * smoothstep(0.15, 1.0, fallAge) * (1.0 - smoothstep(4.8, 6.6, fallAge))
      * exp(-pow(frq / (R * 1.7), 2.0));
    qp -= normalize(fq + vec2(0.001)) * back;

    float span = H - hy;
    float v = clamp((qp.y - hy) / span, 0.0, 1.0);
    const float N = 32.0;
    float j0 = floor(sqrt(v) * N);
    vec3 dots = vec3(0.0);
    for (int dj = -1; dj <= 1; dj++) {
      float j = j0 + float(dj);
      if (j < 0.0) continue;
      float sj = (j + 0.5) / N;
      float rowY = hy + sj * sj * span;
      float dy = 2.0 * sj * span / N;
      float dx = max(dy * 1.35, 5.5 * S);
      float rad = max(dy * 0.15, 0.9 * S);
      float far = 0.3 + 0.7 * smoothstep(0.05, 0.7, sj);
      float i0 = floor((qp.x - W * 0.5) / dx);
      for (int di = -1; di <= 1; di++) {
        vec2 cell = vec2(i0 + float(di), j);
        float a1 = hash12(cell + 0.37);
        float a2 = hash12(cell + 7.1);
        float a3 = hash12(cell + 19.3);
        vec2 c = vec2(W * 0.5 + (cell.x + 0.5 + (a1 - 0.5) * 0.8) * dx, rowY + (a2 - 0.5) * dy * 0.7);
        c.x += sin(t * (0.7 + a3) + a1 * 30.0) * dx * 0.12 * moving;
        c.y -= env * uOn * dy * 0.4 * (0.5 + a3);
        float dd = length(qp - c);
        float lit = smoothstep(rad + 1.0 * S, rad - 0.6 * S, dd) + exp(-dd / (rad * 2.2)) * 0.32;
        if (lit < 0.003) continue;
        float twinkle = pow(max(0.0, sin(t * (0.5 + a3 * 0.9) * moving + a2 * 50.0)), 14.0);
        float idle = (0.055 + 0.6 * twinkle + uKey * 0.55 * step(0.55, a1)) * far;
        float flash = step(0.6, hash12(cell + floor(uBeat) * 1.31)) * env;
        float wave = pow(max(0.0, sin((c.x / W) * 6.2832 - uBeat * 1.5708 + sj * 2.0)), 10.0) * moving;
        vec3 tint = mix(vec3(0.82, 0.86, 1.0), uPal[int(a3 * 3.99)], uOn);
        vec3 cc = tint * (idle + uOn * far * (0.05 + flash * 1.5 + wave * 1.0 + uBoost * 0.6));
        cc += rip * 3.4;
        float frc = length((c - uFall.xy) * vec2(1.0, 2.0));
        float inside = smoothstep(R * 1.05, R * 0.85, frc);
        float around = smoothstep(R * 0.95, R * 1.15, frc) * smoothstep(R * 2.9, R * 2.1, frc);
        float chase = pow(0.5 + 0.5 * sin(frc / (15.0 * S) - fallAge * 10.0), 3.0);
        cc = mix(cc, red * 2.4 * sos, inside * alertOn);
        cc = mix(cc, vec3(0.3, 1.0, 0.42) * 1.9 * chase, around * guideOn);
        dots += cc * lit;
      }
    }
    col += dots * smoothstep(hy - 6.0 * S, hy + 20.0 * S, p.y);
  }

  col = vec3(1.0) - exp(-col * 1.3);
  vec2 vq = p / vec2(W, H) - 0.5;
  float vig = 1.0 - 0.6 * pow(length(vq * vec2(0.9, 1.1)) * 1.3, 2.4);
  col *= clamp(vig, 0.0, 1.0);
  col += vec3(0.043, 0.043, 0.047);
  col += (hash12(p + fract(t * 7.0) * 91.0) - 0.5) / 255.0;
  outColor = vec4(col, 1.0);
}`

const RIPPLES = 12

export interface StageLevels {
  on: number
  spot: number
  boost: number
}

export interface Stage {
  levels: StageLevels
  calm: boolean
  resize(): void
  setFace(x: number, y: number, r: number): void
  setHorizon(y: number): void
  ripple(x: number, y: number, size?: number, color?: RGB): void
  pointer(x: number, y: number, inside: boolean): void
  key(): void
  fall(x: number, y: number): void
  frame(now: number): void
  destroy(): void
}

function compile(gl: WebGL2RenderingContext, type: number, src: string) {
  const sh = gl.createShader(type)
  if (!sh) return null
  gl.shaderSource(sh, src)
  gl.compileShader(sh)
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('[stage]', gl.getShaderInfoLog(sh))
    gl.deleteShader(sh)
    return null
  }
  return sh
}

export function createStage(canvas: HTMLCanvasElement): Stage | null {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    premultipliedAlpha: false,
    powerPreference: 'high-performance',
  })
  if (!gl) return null
  const vs = compile(gl, gl.VERTEX_SHADER, VERT)
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return null
  const prog = gl.createProgram()
  if (!prog) return null
  gl.attachShader(prog, vs)
  gl.attachShader(prog, fs)
  gl.linkProgram(prog)
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.warn('[stage]', gl.getProgramInfoLog(prog))
    return null
  }
  gl.useProgram(prog)

  const buf = gl.createBuffer()
  gl.bindBuffer(gl.ARRAY_BUFFER, buf)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  const aPos = gl.getAttribLocation(prog, 'aPos')
  gl.enableVertexAttribArray(aPos)
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0)

  const names = [
    'uRes', 'uTime', 'uBeat', 'uOn', 'uSpot', 'uKey', 'uBoost', 'uCalm', 'uScale', 'uHorizon',
    'uFace', 'uPtr', 'uPal', 'uRip', 'uRipC', 'uFall',
  ] as const
  const u = Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(prog, n)])) as Record<
    (typeof names)[number],
    WebGLUniformLocation | null
  >

  const start = performance.now()
  const rip = new Float32Array(RIPPLES * 4).fill(-100)
  const ripC = new Float32Array(RIPPLES * 3)
  let ripNext = 0
  let ripColor = 0
  const fallState = new Float32Array([0, 0, -100, 0])
  let fallUntil = 0
  const face = [0, 0, 100]
  let horizon = 0
  const ptr = [0, 0, 0]
  let ptrTarget = 0
  let keyFlash = 0
  let scale = 1
  let quality = 1
  let last = 0
  let slowFrames = 0

  const stage: Stage = {
    levels: { on: 0, spot: 0, boost: 0 },
    calm: false,

    resize() {
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      const area = w * h * dpr * dpr
      const budget = 1.9e6 * quality
      scale = dpr * Math.min(1, Math.sqrt(budget / Math.max(1, area)))
      canvas.width = Math.max(1, Math.round(w * scale))
      canvas.height = Math.max(1, Math.round(h * scale))
      gl.viewport(0, 0, canvas.width, canvas.height)
    },

    setFace(x, y, r) {
      face[0] = x
      face[1] = y
      face[2] = r
    },

    setHorizon(y) {
      horizon = y
    },

    ripple(x, y, size = 1, color) {
      const t = (performance.now() - start) / 1000
      const k = ripNext
      ripNext = (ripNext + 1) % RIPPLES
      rip[k * 4] = x * scale
      rip[k * 4 + 1] = y * scale
      rip[k * 4 + 2] = t
      rip[k * 4 + 3] = size
      const c = color ?? wheel(ripColor++)
      ripC[k * 3] = c[0]
      ripC[k * 3 + 1] = c[1]
      ripC[k * 3 + 2] = c[2]
    },

    pointer(x, y, inside) {
      ptr[0] = x
      ptr[1] = y
      ptrTarget = inside ? 1 : 0
    },

    key() {
      keyFlash = 1
    },

    fall(x, y) {
      const now = performance.now()
      fallState[0] = x * scale
      fallState[1] = y * scale
      fallState[2] = (now - start) / 1000
      fallState[3] = 1
      fallUntil = now + 7000
    },

    frame(now) {
      const dt = last ? Math.min(0.1, (now - last) / 1000) : 1 / 60
      if (last && !stage.calm) {
        slowFrames = dt > 0.026 ? slowFrames + 1 : Math.max(0, slowFrames - 1)
        if (slowFrames > 45 && quality > 0.45) {
          quality *= 0.75
          slowFrames = 0
          stage.resize()
        }
      }
      last = now
      keyFlash *= Math.exp(-dt * 7)
      ptr[2] += (ptrTarget - ptr[2]) * (1 - Math.exp(-dt * 4))
      if (fallState[3] && now > fallUntil) fallState[3] = 0

      const beat = stage.calm ? 0.5 : beatAt(now)
      const pal = palette(beat)
      const t = (now - start) / 1000

      gl.uniform2f(u.uRes, canvas.width, canvas.height)
      gl.uniform1f(u.uTime, stage.calm ? 12 : t)
      gl.uniform1f(u.uBeat, beat)
      gl.uniform1f(u.uOn, stage.levels.on)
      gl.uniform1f(u.uSpot, stage.levels.spot)
      gl.uniform1f(u.uKey, keyFlash)
      gl.uniform1f(u.uBoost, stage.levels.boost)
      gl.uniform1f(u.uCalm, stage.calm ? 1 : 0)
      gl.uniform1f(u.uScale, scale)
      gl.uniform1f(u.uHorizon, horizon * scale)
      gl.uniform3f(u.uFace, face[0] * scale, face[1] * scale, face[2] * scale)
      gl.uniform3f(u.uPtr, ptr[0] * scale, ptr[1] * scale, ptr[2])
      gl.uniform3fv(u.uPal, pal.flat())
      gl.uniform4fv(u.uRip, rip)
      gl.uniform3fv(u.uRipC, ripC)
      gl.uniform4fv(u.uFall, fallState)
      gl.drawArrays(gl.TRIANGLES, 0, 3)
    },

    destroy() {
      gl.getExtension('WEBGL_lose_context')?.loseContext()
    },
  }

  stage.resize()
  return stage
}
