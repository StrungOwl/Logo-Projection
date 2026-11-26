// Morph transitions — seamless mode changes with no blink to black.
//
// How it works: when a morph starts, the last finished frame of the OLD
// look is copied into a texture (a snapshot). The mode then flips at once,
// and for the next few seconds this pass draws the snapshot over the NEW
// live look, warped and dissolved by one of these styles:
//
//   'fade'      plain cross-fade (for seams where both looks share a sky)
//   'dissolve'  organic noise dissolve with a thin gold burning edge
//   'iris'      the new look grows out of the star in a four-point front
//   'vortex'    the old look twists and streaks into the star centre
//               (stars smear into spiral flow lines)
//   'zoom'      the old look rushes toward the viewer through the star
//   'melt'      the old look slides down in uneven runs and uncovers
//               the new one
//   'pour'      the new look runs down over the old one from the top,
//               with a drippy front and a line of light on it (liquid
//               gold pours back over the logo)
//
// The warped snapshot is masked to the logo outline (the convex hull, the
// same footprint the shader looks draw), so a transition never throws
// light outside the physical surface.
//
// The pass sits after OutputPass (display-referred pixels) and before the
// corner-pin warp. It is disabled outside a transition, so it costs
// nothing in normal running. Needs ANIM.post.enabled (the composer path);
// without it the transition manager falls back to 'dip'.

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export const MORPH_STYLES = ['fade', 'dissolve', 'iris', 'vortex', 'zoom', 'melt', 'pour'];
const STYLE_ID = { fade: 0, dissolve: 1, iris: 2, vortex: 3, zoom: 4, melt: 5, pour: 6 };

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const COPY_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tDiffuse, vUv); }
`;

const MIX_FRAG = /* glsl */`
  uniform sampler2D tDiffuse;   // new look, live
  uniform sampler2D tOld;       // snapshot of the old look
  uniform sampler2D tMask;      // logo outline, white inside
  uniform float uP;             // 0..1 progress
  uniform int   uStyle;
  uniform vec2  uC;             // star centre in uv
  uniform float uAspect;        // width / height
  uniform float uR;             // logo radius in uv-height units
  uniform float uSeed;
  uniform vec3  uGold;
  varying vec2  vUv;

  float hn(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hn(i), hn(i + vec2(1.0, 0.0)), u.x),
               mix(hn(i + vec2(0.0, 1.0)), hn(i + vec2(1.0, 1.0)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * vn(p); p = p * 2.03 + vec2(17.0, 31.0); a *= 0.5; }
    return v;
  }
  vec2 rot(vec2 v, float a) { float c = cos(a), s = sin(a); return vec2(c * v.x - s * v.y, s * v.x + c * v.y); }
  // q is aspect-corrected (uv-height units) relative to the star centre.
  vec2 toUv(vec2 q) { return uC + vec2(q.x / uAspect, q.y); }
  vec3 oldAt(vec2 uv) {
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec3(0.0);
    return texture2D(tOld, uv).rgb;
  }

  void main() {
    vec3 neu = texture2D(tDiffuse, vUv).rgb;
    float p = clamp(uP, 0.0, 1.0);
    float ps = p * p * (3.0 - 2.0 * p);
    vec2 q = vec2((vUv.x - uC.x) * uAspect, vUv.y - uC.y);
    float r = length(q) / max(uR, 1e-4);          // 0 centre .. ~1 rim
    float mask = texture2D(tMask, vUv).r;
    // The mask eases in, so the frame at p = 0 is exactly the old frame.
    float m = mix(1.0, mask, smoothstep(0.0, 0.12, p));
    vec3 col;

    if (uStyle == 0) {
      // ---- fade ----
      col = mix(texture2D(tOld, vUv).rgb, neu, ps);

    } else if (uStyle == 1 || uStyle == 2) {
      // ---- dissolve / iris: a threshold field with a burning edge ----
      float f;
      if (uStyle == 1) {
        float n = fbm(q / uR * 3.2 + uSeed);
        f = n * 0.72 + 0.28 * clamp(r, 0.0, 1.2) / 1.2;
      } else {
        float ang = atan(q.y, q.x);
        float arms = pow(abs(cos(2.0 * ang)), 5.0);          // 1 on the four axes
        f = r * (1.0 - 0.42 * arms) / 1.15 + 0.07 * (fbm(q / uR * 5.0 + uSeed) - 0.5);
      }
      float th = p * 1.24 - 0.12;
      float w = 0.030;
      float a = 1.0 - smoothstep(th - w, th + w, f);          // 1 = new look
      // a thin line of light on the front, only on the logo
      float e = exp(-pow((f - th) / 0.009, 2.0)) * sin(p * 3.14159);
      col = mix(texture2D(tOld, vUv).rgb, neu, a) + uGold * e * 0.6 * mask;

    } else if (uStyle == 3) {
      // ---- vortex: twist + pull into the star, streaked along the arc ----
      float twist = ps * 4.6 / (r * 1.8 + 0.30);
      float shrink = 1.0 + 2.4 * ps * ps;
      float span = ps * 1.1 / (r * 1.5 + 0.35);
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 12; i++) {
        float f = float(i) / 11.0;
        vec2 s = rot(q, twist - span * f) * shrink * (1.0 + 0.10 * f * ps);
        acc = max(acc, oldAt(toUv(s)) * (1.0 - 0.72 * f));
      }
      float aOld = 1.0 - smoothstep(0.42, 1.0, p);
      float aNew = smoothstep(0.08, 0.80, p);
      col = neu * aNew + acc * aOld * m;

    } else if (uStyle == 4) {
      // ---- zoom: the old look rushes past, the new one opens from the star ----
      float sc = 1.0 + 5.0 * pow(p, 2.4);
      vec3 acc = vec3(0.0);
      for (int i = 0; i < 6; i++) {
        float f = float(i) / 5.0;
        acc += oldAt(toUv(q / (sc * (1.0 + 0.10 * f * ps))));
      }
      acc /= 6.0;
      float aOld = 1.0 - smoothstep(0.30, 0.95, p);
      float front = p * 1.9;
      float aNew = (1.0 - smoothstep(front - 0.45, front, r)) * smoothstep(0.0, 0.25, p);
      aNew = max(aNew, smoothstep(0.75, 1.0, p));
      col = mix(acc * aOld * m, neu, aNew);

    } else if (uStyle == 6) {
      // ---- pour: the new look runs down from the top, drips ahead ----
      float x = q.x / uR;
      float yn = (uC.y + uR * 1.08 - vUv.y) / (2.2 * uR);            // 0 top .. 1 foot
      float n = vn(vec2(x * 2.6 + uSeed, 0.5));
      float drip = pow(vn(vec2(x * 11.0 + uSeed * 1.7, 7.5)), 2.6)
                 + 0.6 * pow(vn(vec2(x * 23.0 - uSeed, 2.5)), 4.0);
      float lead = sin(p * 3.14159);
      float front = p * 1.42 - 0.16 + 0.10 * (n - 0.5) + drip * 0.20 * sqrt(max(lead, 0.0));
      float a = 1.0 - smoothstep(front - 0.012, front + 0.004, yn);   // 1 = new look
      float e = exp(-pow((yn - front) / 0.012, 2.0)) * lead;
      col = mix(texture2D(tOld, vUv).rgb, neu, a) + uGold * e * 0.7 * mask;

    } else {
      // ---- melt: the old look runs down in uneven columns ----
      float x = q.x / uR;
      // slow wide runs, plus narrow drips that run ahead of them
      float n = vn(vec2(x * 3.2 + uSeed, 0.5)) * 0.70 + vn(vec2(x * 8.0 - uSeed, 3.5)) * 0.30;
      float drip = pow(vn(vec2(x * 13.0 + uSeed * 1.7, 7.5)), 3.0);
      float drop = smoothstep(0.0, 1.0, p * 1.5 - n * 0.5 + drip * 0.22 * sin(p * 3.14159));
      float d = drop * drop * 2.4 * uR;
      vec2 src = vec2(vUv.x, vUv.y + d);
      float srcIn = (src.y > 1.0) ? 0.0 : texture2D(tMask, src).r;
      float aOld = mix(1.0, srcIn * mask, smoothstep(0.0, 0.10, p));
      aOld *= 1.0 - smoothstep(0.92, 1.0, p);
      col = mix(neu, oldAt(src), aOld);
    }

    gl_FragColor = vec4(col, 1.0);
  }
`;

class MorphPass extends Pass {
  constructor(owner) {
    super();
    this.owner = owner;
    this.enabled = false;
    this.needsSwap = true;
    this.copyMat = new THREE.ShaderMaterial({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: VERT, fragmentShader: COPY_FRAG,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.mixMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tOld: { value: null }, tMask: { value: null },
        uP: { value: 0 }, uStyle: { value: 0 },
        uC: { value: new THREE.Vector2(0.5, 0.5) }, uAspect: { value: 1 }, uR: { value: 0.4 },
        uSeed: { value: 0 }, uGold: { value: new THREE.Color('#FFC56A') },
      },
      vertexShader: VERT, fragmentShader: MIX_FRAG,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.fsCopy = new FullScreenQuad(this.copyMat);
    this.fsMix  = new FullScreenQuad(this.mixMat);
  }

  render(renderer, writeBuffer, readBuffer) {
    const o = this.owner;
    if (o.wantCapture) {
      o.capture(renderer, readBuffer, this);
      o.wantCapture = false;
      o.hasCapture = true;
    }
    const u = this.mixMat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsMix.render(renderer);
  }

  dispose() {
    this.copyMat.dispose(); this.mixMat.dispose();
    this.fsCopy.dispose(); this.fsMix.dispose();
  }
}

export function createMorph({ camera }) {
  let oldRT = null, maskRT = null;
  let maskScene = null, centerLocal = null, rimLocal = null, logoMeshRef = null;
  const tmpColor = new THREE.Color();
  const v0 = new THREE.Vector3(), v1 = new THREE.Vector3();

  const owner = {
    wantCapture: false,
    hasCapture: false,
    capture(renderer, readBuffer, pass) {
      const w = readBuffer.width, h = readBuffer.height;
      if (!oldRT || oldRT.width !== w || oldRT.height !== h) {
        oldRT?.dispose(); maskRT?.dispose();
        oldRT  = new THREE.WebGLRenderTarget(w, h, { type: THREE.HalfFloatType, depthBuffer: false });
        maskRT = new THREE.WebGLRenderTarget(Math.max(2, w >> 1), Math.max(2, h >> 1), { depthBuffer: false });
      }
      // 1. snapshot of the finished old frame
      pass.copyMat.uniforms.tDiffuse.value = readBuffer.texture;
      renderer.setRenderTarget(oldRT);
      pass.fsCopy.render(renderer);
      // 2. logo outline mask, drawn with the live camera
      const prevAuto = renderer.autoClear;
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(tmpColor);
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(maskRT);
      if (maskScene) renderer.render(maskScene, camera);
      else renderer.clear();
      renderer.setClearColor(tmpColor, prevAlpha);
      renderer.autoClear = prevAuto;
      // 3. star centre + logo radius on screen
      const u = pass.mixMat.uniforms;
      u.tOld.value = oldRT.texture;
      u.tMask.value = maskRT.texture;
      u.uAspect.value = w / h;
      if (logoMeshRef && centerLocal) {
        v0.copy(centerLocal).applyMatrix4(logoMeshRef.matrixWorld).project(camera);
        v1.copy(rimLocal).applyMatrix4(logoMeshRef.matrixWorld).project(camera);
        u.uC.value.set(v0.x * 0.5 + 0.5, v0.y * 0.5 + 0.5);
        u.uR.value = Math.max(0.05, Math.abs(v1.y - v0.y) * 0.5);
      }
    },
  };
  const pass = new MorphPass(owner);

  return {
    pass,
    // Called once the logo is loaded: builds the outline mask scene.
    attachLogo(logoMesh, meta) {
      logoMeshRef = logoMesh;
      const shape = new THREE.Shape((meta.footprint || meta.hull).map(p => new THREE.Vector2(p.x, p.y)));
      const mesh = new THREE.Mesh(
        new THREE.ShapeGeometry(shape),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, depthTest: false, side: THREE.DoubleSide }),
      );
      mesh.position.z = meta.maxZ;
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.matrix.copy(logoMesh.matrixWorld);
      holder.add(mesh);
      maskScene = new THREE.Scene();
      maskScene.add(holder);
      const cx = meta.cx + (meta.patternFadeCenter?.[0] || 0);
      const cy = meta.cy + (meta.patternFadeCenter?.[1] || 0);
      centerLocal = new THREE.Vector3(cx, cy, meta.maxZ);
      rimLocal    = new THREE.Vector3(cx, cy + meta.maxR, meta.maxZ);
    },
    ready: () => !!maskScene,
    begin(style) {
      const u = pass.mixMat.uniforms;
      u.uStyle.value = STYLE_ID[style] ?? 0;
      u.uP.value = 0;
      u.uSeed.value = Math.random() * 40;
      owner.wantCapture = true;
      owner.hasCapture = false;
      pass.enabled = true;
    },
    captured: () => owner.hasCapture,
    setProgress(p) { pass.mixMat.uniforms.uP.value = p; },
    end() {
      pass.enabled = false;
      owner.wantCapture = false;
      owner.hasCapture = false;
    },
  };
}
