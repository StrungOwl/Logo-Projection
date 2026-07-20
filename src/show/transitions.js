// Mode-transition manager. Owns WHEN ANIM.viewMode flips; the per-group
// visibility gating in main.js stays untouched — the hard cut simply
// happens while the frame is at (or near) black, wrapped in a global
// luminance envelope.
//
// Styles:
//   'cut'       immediate flip (legacy behavior)
//   'dip'       exposure 1 → 0, flip at blackpoint, 0 → 1 eased
//   'wipe'      silhouette-shaped black disc expands from the pattern
//               center, flip under full cover, then recedes — light never
//               spills outside the physical surface
//   'edgeFlash' dip + 'edge.burst' trigger fired at the flip frame
//
// The envelope drives renderer.toneMappingExposure directly (OutputPass
// reads it, so this works identically pre- and post-composer). Bloom
// strength must ride the same envelope — otherwise the bloom of the last
// bright frame ghosts through the black — so the pipeline multiplies its
// per-frame ANIM.post.bloom.strength sync by envelope() (Phase 4 wiring).
//
// Live-editing stays intact: a direct ANIM.viewMode write (devtools or
// probes) is detected each update and adopted without an envelope.

import * as THREE from 'three';
import { ANIM } from '../config.js';
import { fireTrigger } from './triggers.js';
import { buildSilhouetteShape } from '../util/geometry.js';

const easeInOut = (x) => x * x * (3 - 2 * x);

export function createTransitionManager({ renderer }) {
  const baseExposure = renderer.toneMappingExposure;

  const st = {
    phase: 'idle',        // 'idle' | 'out' | 'in'
    style: 'dip',
    target: null,
    p: 0,                 // 0..1 progress within current phase
    lastApplied: ANIM.viewMode,
    env: 1,               // luminance envelope, 1 = fully visible
  };

  // ---- wipe overlay (built lazily once the logo is loaded) -------------
  let wipe = null;        // { mesh, mat, maxR }
  function attachWipe(logoMesh, meta) {
    // Hull-shaped (convex) so the cutout region — where the galaxy and
    // flame draw — is covered too. Same footprint as the galaxy plate.
    const shape = new THREE.Shape(meta.hull.map(p => new THREE.Vector2(p.x, p.y)));
    const cx = meta.cx + (meta.patternFadeCenter?.[0] || 0);
    const cy = meta.cy + (meta.patternFadeCenter?.[1] || 0);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uWipeR:   { value: 0 },
        uFeather: { value: (ANIM.transitions?.feather ?? 1.5) },
        uCenter:  { value: new THREE.Vector2(cx, cy) },
      },
      vertexShader: /* glsl */`
        varying vec2 vPos;
        void main() {
          vPos = position.xy;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uWipeR;
        uniform float uFeather;
        uniform vec2  uCenter;
        varying vec2  vPos;
        void main() {
          float d = distance(vPos, uCenter);
          float a = 1.0 - smoothstep(uWipeR - uFeather, uWipeR, d);
          gl_FragColor = vec4(0.0, 0.0, 0.0, a);
        }
      `,
    });
    const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape), mat);
    mesh.renderOrder = 999;
    mesh.visible = false;
    // Sit in front of the gate frame but inherit the logo transform via a
    // world-matrix copy (the overlay must track the logo, not the camera).
    const holder = new THREE.Group();
    holder.matrixAutoUpdate = false;
    holder.matrix.copy(logoMesh.matrixWorld);
    mesh.position.z = meta.maxZ + 2.0;
    holder.add(mesh);
    wipe = { mesh, mat, holder, maxR: meta.maxR * 1.1 };
    return holder;   // caller adds to scene
  }

  function requestMode(mode, style) {
    if (mode === ANIM.viewMode && st.phase === 'idle') return;
    const s = style || ANIM.transitions?.defaultStyle || 'dip';
    // Mid-transition re-requests: during fade-OUT just retarget the
    // pending flip; during fade-IN reverse back out toward the new mode
    // from the current envelope level (dropping the request here was the
    // "I have to press the key a couple times" bug).
    if (st.phase === 'out') { st.target = mode; return; }
    if (st.phase === 'in') {
      st.target = mode;
      st.phase = 'out';
      // env == p during fade-in; fade-out computes env = 1 - p, so
      // continuing from the same brightness means p_out = 1 - p_in.
      st.p = 1 - st.p;
      if (st.style === 'wipe' && wipe) wipe.mesh.visible = true;
      return;
    }
    if (s === 'cut') {
      ANIM.viewMode = mode;
      st.lastApplied = mode;
      return;
    }
    if (s === 'wipe' && !wipe) return requestMode(mode, 'dip');
    st.phase = 'out';
    st.style = s;
    st.target = mode;
    st.p = 0;
  }

  function applyEnvelope() {
    renderer.toneMappingExposure = baseExposure * easeInOut(st.env);
  }

  function update(t, dt) {
    // Adopt external ANIM.viewMode writes (devtools, probes, export pin).
    if (st.phase === 'idle' && ANIM.viewMode !== st.lastApplied) {
      st.lastApplied = ANIM.viewMode;
    }
    if (st.phase === 'idle') return;

    const cfg = ANIM.transitions || {};
    const isWipe = st.style === 'wipe';
    const outDur = isWipe ? (cfg.wipeDur ?? 0.9) / 2 : (cfg.outDur ?? 0.35);
    const inDur  = isWipe ? (cfg.wipeDur ?? 0.9) / 2 : (cfg.inDur  ?? 0.6);

    if (st.phase === 'out') {
      st.p = Math.min(1, st.p + dt / Math.max(outDur, 1e-3));
      if (isWipe) {
        wipe.mesh.visible = true;
        wipe.mat.uniforms.uWipeR.value = st.p * wipe.maxR;
      } else {
        st.env = 1 - st.p;
        applyEnvelope();
      }
      if (st.p >= 1) {
        ANIM.viewMode = st.target;
        st.lastApplied = st.target;
        if (st.style === 'edgeFlash') fireTrigger('edge.burst', t);
        st.phase = 'in';
        st.p = 0;
      }
    } else if (st.phase === 'in') {
      st.p = Math.min(1, st.p + dt / Math.max(inDur, 1e-3));
      if (isWipe) {
        wipe.mat.uniforms.uWipeR.value = (1 - st.p) * wipe.maxR;
      } else {
        st.env = st.p;
        applyEnvelope();
      }
      if (st.p >= 1) {
        st.phase = 'idle';
        st.env = 1;
        applyEnvelope();
        if (isWipe) wipe.mesh.visible = false;
      }
    }
  }

  return {
    requestMode,
    update,
    attachWipe,
    isTransitioning: () => st.phase !== 'idle',
    // Bloom rides this so glow can't ghost through the dip (pipeline
    // multiplies its per-frame bloom-strength sync by it).
    envelope: () => easeInOut(st.env),
  };
}
