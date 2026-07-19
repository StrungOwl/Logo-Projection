// Fractal "telescope" zoom — drives viewMode 'fractalPattern' (key 1).
//
// State machine:
//   rest  → originals at full opacity, parked at rest. Clones hidden.
//           Wait `triggerDelay` (first entry) or `loopStaticDur` (between
//           loops); 0 → park forever. Then enter intro.
//   intro → originals fade 1 → 0; clone stack emerges from focal centre
//           with d ramping 0 → 1 and cloneOp 0 → 1 on a shared smoothstep.
//           The synchronised ramp covers the silhouette interior exactly
//           once at every instant: never zero, never twice.
//   dive  → smoothstep ease from d=1 to the next integer target so a clone
//           lands at r=0 (scale 1, peak Gaussian opacity = 1) — visually
//           identical to the rest pattern. Originals stay invisible.
//           Past-peak clones + droLayerRotation give the "falling through
//           infinite copies" motion.
//   landing → crossfade out of the dive into the rest pattern over
//           `landingDuration`. d held at the integer target so the at-peak
//           clone sits pixel-identical to the rest pattern throughout.
//
// Continuous Droste dive: one global d drives every clone. Each clone's
// "role" rotates through the full life cycle (tiny emergent → peak →
// grown past peak → escape) as d advances; modular arithmetic makes that
// rotation seamless because the wraparound happens where opacity is
// already zero.

import * as THREE from 'three';
import { ANIM } from '../../config.js';
import { chainOnBeforeCompile, RADIAL_FADE_ALPHA_BODY, RADIAL_FADE_ALPHA_STROKE }
  from '../_shared/shaderPatches.js';

function noop() {}

function smoothstep(x) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  return x * x * (3 - 2 * x);
}

export function createFractalZoom({
  panel,           // THREE.Group — islamic-tile panel (originals)
  underlay,        // THREE.Group — lattice underlay (originals)
  cascadeMeshes,   // [Mesh] originals the fractal parks each frame
  focalCenter,     // [fx, fy] in panel-local coords
  logoCx,          // logo x offset (panel sits at (cx, cy) in logoMesh)
  logoCy,
  logoMesh,        // parent for the fractalRoot group
}) {
  const [fcx, fcy] = focalCenter;

  // Cache base mesh transforms so park calls restore exact rest poses.
  for (let i = 0; i < cascadeMeshes.length; i++) {
    const m = cascadeMeshes[i];
    m.userData.baseScaleX = m.scale.x;
    m.userData.baseScaleY = m.scale.y;
    m.userData.baseScaleZ = m.scale.z;
  }

  // Max tile radius (set by the row-cascade init upstream) drives reveal
  // stagger phase normalisation.
  let maxRadius = 0;
  for (let i = 0; i < cascadeMeshes.length; i++) {
    const r = cascadeMeshes[i].userData.radius || 0;
    if (r > maxRadius) maxRadius = r;
  }

  // Shared uniform refs read by every clone material's fragment shader.
  // The shader multiplies gl_FragColor.a by
  //   1 - smoothstep(uCloneScaleFadeStart, uCloneScaleFadeEnd, uCloneScale)
  // so clones grown PAST peak fade smoothly to invisible before their
  // unit-sized inner-star cutout reads as a giant centred hole. Refreshed
  // each frame from ANIM.fractalZoom so the knobs are live-editable.
  const cloneScaleFadeStartUniform = { value: 99.0 };
  const cloneScaleFadeEndUniform   = { value: 100.0 };

  function cloneMaterialPreservingTime(origMat, cloneScaleUniform) {
    if (!origMat) return origMat;
    if (Array.isArray(origMat)) {
      return origMat.map(m => cloneMaterialPreservingTime(m, cloneScaleUniform));
    }
    const m = origMat.clone();
    // Don't share any uniforms with the original. The patterns'
    // onBeforeCompile wires shader.uniforms to a SHARED closure object
    // (pulseUniforms / strokeUniforms) via Object.assign. The cloned
    // material's wrapped onBeforeCompile (below) overrides those slots
    // with frozen refs so clones don't sample the live animation —
    // overlapping clones at different scales all reading the same
    // per-frame uPulseTime / uTwinkleSeed values is what produced the
    // brightness flicker.
    m.transparent = true;

    // Wrap the original onBeforeCompile to "un-scale" vPanelXY so the
    // existing radial fade + hullClip operate in CLONE-LOCAL coords, not
    // absolute panel-local coords. Without this, a clone at scale 0.5
    // has its vertices at HALF distance from fadeCenter — the inner-star
    // cutout (sized for the original) eats half the clone's content, AND
    // the radial fade dims everything because the clone lives entirely
    // inside the central fade zone. The override re-projects each clone
    // vertex back to "as if I were at scale 1" before the fade/hull tests
    // run, so each clone has its OWN proportionally-sized inner-star
    // cutout and full fade range.
    if (origMat.onBeforeCompile) {
      // Per-clone frozen uniform refs. Each call builds its own set so
      // clones don't share state with each other either — every clone is
      // a fully independent static snapshot of the source material at
      // clone-init time.
      const frozenU = {
        uPulseTime:   { value: 0 },
        uTime:        { value: 0 },
        uTwinkleSeed: { value: 0 },
      };
      // Material.clone() does not carry onBeforeCompile over — re-attach
      // the source material's patch, then chain the clone-specific rewrite
      // AFTER it so the replace targets below exist when it runs.
      m.onBeforeCompile = origMat.onBeforeCompile;
      chainOnBeforeCompile(m, (shader) => {
        shader.uniforms.uCloneScale          = cloneScaleUniform;
        shader.uniforms.uCloneScaleFadeStart = cloneScaleFadeStartUniform;
        shader.uniforms.uCloneScaleFadeEnd   = cloneScaleFadeEndUniform;
        // Replace the time-driven shared uniforms with frozen refs so
        // the cloned shader compiles against a steady snapshot.
        for (const k of Object.keys(frozenU)) {
          if (shader.uniforms[k]) shader.uniforms[k] = frozenU[k];
        }
        // Isolate uMaxOpacity per-clone. fadeGradUniforms.uMaxOpacity is
        // a SHARED ref between every original mesh and every cloned mesh
        // (the source patch just Object.assign'd it). The clone-fade code
        // mat.uniforms.uMaxOpacity.value every frame to drive cloneOp —
        // but because the ref is shared, those writes also mutate the
        // originals' rendered opacity. Replace with a fresh per-clone
        // copy so the fadeables sweep below writes only to clone-local.
        if (shader.uniforms.uMaxOpacity) {
          shader.uniforms.uMaxOpacity = {
            value: shader.uniforms.uMaxOpacity.value
          };
        }
        // Add the uniform declaration to the vertex shader and rewrite
        // the vPanelXY assignment to un-scale around uFadeCenter.
        shader.vertexShader = shader.vertexShader.replace(
          'varying vec2 vPanelXY;\nuniform mat4 uPanelInv;',
          `varying vec2 vPanelXY;
           uniform mat4  uPanelInv;
           uniform vec2  uFadeCenter;
           uniform float uCloneScale;`
        );
        shader.vertexShader = shader.vertexShader.replace(
          'vPanelXY = (uPanelInv * _wp).xy;',
          `vec2 _origPanelXY = (uPanelInv * _wp).xy;
           // Un-scale only for clones SMALLER than 1 (each shrunken clone
           // gets its own proportional inner-star cutout + radial fade).
           // For clones grown PAST 1 (zoom-through dive) leave the coord
           // in true panel space so the silhouette hullClip still trims
           // anything spilling past the gate frame.
           float _csInv = 1.0 / clamp(uCloneScale, 0.001, 1.0);
           vPanelXY = (_origPanelXY - uFadeCenter) * _csInv + uFadeCenter;`
        );
        // Fragment shader: fade clones grown past peak via smoothstep on
        // uCloneScale. The original onBeforeCompile already injected
        // `uniform float uMaxOpacity;` and the alpha multiply line — we
        // extend both. Materials without uMaxOpacity (e.g. debug) are
        // unaffected because the replace target won't match.
        shader.fragmentShader = shader.fragmentShader
          .replace(
            'uniform float uMaxOpacity;',
            `uniform float uMaxOpacity;
             uniform float uCloneScale;
             uniform float uCloneScaleFadeStart;
             uniform float uCloneScaleFadeEnd;`
          )
          .replace(
            RADIAL_FADE_ALPHA_STROKE,
            `gl_FragColor.a *= _a * uMaxOpacity * _twinkle * (1.0 - smoothstep(uCloneScaleFadeStart, uCloneScaleFadeEnd, uCloneScale));`
          )
          .replace(
            RADIAL_FADE_ALPHA_BODY,
            `gl_FragColor.a *= _a * uMaxOpacity * (1.0 - smoothstep(uCloneScaleFadeStart, uCloneScaleFadeEnd, uCloneScale));`
          );
      });
      // Force the cached compiled program to be discarded so our wrapper
      // actually runs.
      m.needsUpdate = true;
    }
    return m;
  }

  function cloneAllMaterials(root, cloneScaleUniform) {
    // Dedupe by source-material identity. `panel.clone(true)` shallow-shares
    // material refs across many meshes, so without dedup we'd build a
    // unique cloned material per mesh — bloating the per-frame opacity
    // sweep. Sharing one cloned material per source ref keeps `fadeables`
    // proportional to UNIQUE materials, not mesh count.
    const matMap = new Map();
    root.traverse(o => {
      if ((o.isMesh || o.isLine || o.isLineSegments) && o.material) {
        const orig = o.material;
        let cloned = matMap.get(orig);
        if (!cloned) {
          cloned = cloneMaterialPreservingTime(orig, cloneScaleUniform);
          matMap.set(orig, cloned);
        }
        o.material = cloned;
        // Strip per-mesh onBeforeRender callbacks. The lattice-underlay
        // and islamic-tile patterns set onBeforeRender on each tile to
        // write per-tile pulseTime / twinkleSeed into SHARED uniform
        // objects. After clone(true), every cloned mesh inherits the
        // same callback and races to stomp the same shared uniform each
        // frame — that's the flicker. Clones don't need per-tile
        // animations (we've frozen their shader's time uniforms).
        o.onBeforeRender = noop;
      }
    });
  }

  // Originals' fadeable materials — collected once, written each frame so
  // the originals crossfade out as the clone grows in.
  const originalsFadeables = [];
  {
    const seen = new Set();
    [panel, underlay].forEach(g => g.traverse(o => {
      const mat = o.material;
      if (!mat || seen.has(mat)) return;
      seen.add(mat);
      if (mat.uniforms && mat.uniforms.uMaxOpacity) {
        originalsFadeables.push({ mat, kind: 'uniform',
                                  base: mat.uniforms.uMaxOpacity.value });
      } else if (typeof mat.opacity === 'number' && mat.transparent) {
        originalsFadeables.push({ mat, kind: 'opacity', base: mat.opacity });
      }
    }));
  }
  let lastOriginalsOp = NaN;
  function fadeOriginals(opacity) {
    if (Math.abs(opacity - lastOriginalsOp) < 1e-4) return;
    lastOriginalsOp = opacity;
    for (let i = 0; i < originalsFadeables.length; i++) {
      const f = originalsFadeables[i];
      if (f.kind === 'uniform') f.mat.uniforms.uMaxOpacity.value = f.base * opacity;
      else                      f.mat.opacity                    = f.base * opacity;
    }
  }

  // Build N identical cloned copies of (panel + underlay) at the focal
  // centre, each z-recessed by a fixed step for transparent-sort order.
  const fractalState = {
    active: 1, phase: 'rest', phaseStart: 0,
    firstRest: true, lambda: 0, diveD: 0, cloneOp: 0,
  };
  const fractalRoot = new THREE.Group();
  fractalRoot.name = 'fractal-clone';
  fractalRoot.visible = false;
  logoMesh.add(fractalRoot);

  const clones = [];   // [{ pivot, fadeables, cloneScaleUniform, revealTiles, ... }]
  {
    const fcfg = ANIM.fractalZoom || {};
    const N = Math.max(1, fcfg.cloneCount ?? 5);
    const zStep = fcfg.cloneZStep ?? 0.03;
    const jitterMix = Math.min(1, Math.max(0, fcfg.revealStaggerJitter ?? 0));
    const speedMin  = Math.max(0.05, fcfg.revealSpeedMin ?? 1);
    const speedMax  = Math.max(speedMin, fcfg.revealSpeedMax ?? 1);

    for (let k = 0; k < N; k++) {
      const pivot = new THREE.Group();
      // Sit each clone slightly BEHIND the previous one in z. Three.js
      // sorts transparent materials back-to-front by depth, so the deepest
      // (smallest) clone draws first and the largest draws last on top.
      pivot.position.set(logoCx + fcx, logoCy + fcy, -0.02 - k * zStep);
      fractalRoot.add(pivot);

      // Per-clone uCloneScale uniform — driven by applyDive each frame.
      const cloneScaleUniform = { value: 0.001 };

      const cp = panel.clone(true);
      cp.position.set(-fcx, -fcy, panel.position.z);
      const cu = underlay.clone(true);
      cu.position.set(-fcx, -fcy, underlay.position.z);
      // Strip Points (sparks) — their physics shouldn't run inside clones.
      [cp, cu].forEach(g => {
        const toRemove = [];
        g.traverse(o => { if (o.isPoints) toRemove.push(o); });
        for (const p of toRemove) p.parent && p.parent.remove(p);
      });
      cloneAllMaterials(cp, cloneScaleUniform);
      cloneAllMaterials(cu, cloneScaleUniform);
      pivot.add(cp);
      pivot.add(cu);
      pivot.scale.set(0, 0, 1);

      // Per-cloned-material fadeables (deduped) for the per-frame opacity
      // sweep.
      const fadeables = [];
      const seenMats = new Set();
      pivot.traverse(o => {
        const mat = o.material;
        if (!mat || seenMats.has(mat)) return;
        seenMats.add(mat);
        if (mat.uniforms && mat.uniforms.uMaxOpacity) {
          fadeables.push({ mat, kind: 'uniform',
                           base: mat.uniforms.uMaxOpacity.value });
        } else if (typeof mat.opacity === 'number') {
          fadeables.push({ mat, kind: 'opacity', base: mat.opacity });
        }
      });

      // Per-tile reveal stagger. Each tagged tile in the cloned panel +
      // underlay gets a normalized phase ∈ [0,1] that mixes its radial
      // position (innermost first, outermost last) with a per-tile random
      // offset. `revealStaggerJitter` controls the mix:
      //   0   → purely radial (clean wave from focal centre outward).
      //   1   → purely random (no ring structure).
      //   mid → radial trend with per-tile jitter — the bloom-from-centre
      //         feel survives, but individual flowers within a ring grow
      //         on their own timing so any residual flash dissolves.
      const revealTiles = [];
      [cp, cu].forEach(g => g.traverse(o => {
        if (o.userData && o.userData.baseX !== undefined) {
          const r = o.userData.radius || 0;
          const radialPhase = maxRadius > 1e-4 ? r / maxRadius : 0;
          const randomPhase = Math.random();
          const phase = radialPhase * (1 - jitterMix) + randomPhase * jitterMix;
          // Per-tile speed ∈ [speedMin, speedMax]. Combined with the
          // randomized start phase, every flower has its own personality
          // through the zoom — fully kills any wave-front read.
          const speed = speedMin + Math.random() * (speedMax - speedMin);
          revealTiles.push({
            mesh: o,
            revealPhase: phase,
            speed,
            baseScaleX: o.scale.x,
            baseScaleY: o.scale.y,
            baseScaleZ: o.scale.z,
          });
        }
      }));

      clones.push({ pivot, fadeables, cloneScaleUniform, revealTiles,
                    lastRevealMode: 'unset' });
    }
  }

  fractalState.triggerZoom = (t) => {
    fractalState.phase      = 'intro';
    fractalState.phaseStart = t;
  };

  // Reset every original tile to its rest pose.
  function parkOriginalTiles() {
    for (let i = 0; i < cascadeMeshes.length; i++) {
      const m = cascadeMeshes[i];
      m.position.x = m.userData.baseX;
      m.position.y = m.userData.baseY;
      m.scale.set(m.userData.baseScaleX, m.userData.baseScaleY,
                  m.userData.baseScaleZ);
    }
  }

  // Force every clone to opacity 0 + scale 0 (used when leaving pattern
  // mode so the fractal stack is fully invisible).
  function parkAllClones() {
    for (let k = 0; k < clones.length; k++) {
      const c = clones[k];
      c.pivot.scale.set(0, 0, 1);
      c.pivot.rotation.z = 0;
      c.pivot.visible = false;
      c.pivot.matrixWorldAutoUpdate = false;
      c.cloneScaleUniform.value = 0.001;
      for (let i = 0; i < c.fadeables.length; i++) {
        const f = c.fadeables[i];
        if (f.kind === 'uniform') f.mat.uniforms.uMaxOpacity.value = 0;
        else                      f.mat.opacity                    = 0;
      }
      for (let i = 0; i < c.revealTiles.length; i++) {
        const rt = c.revealTiles[i];
        rt.mesh.scale.set(0, 0, rt.baseScaleZ);
      }
      c.lastRevealMode = 'unset';
    }
    lastDiveD = NaN; lastDiveOp = NaN; lastFadeMode = 'unset';
  }

  // Short-circuit caches: d/op/fade are constant during long plateaus.
  let lastDiveD    = NaN;
  let lastDiveOp   = NaN;
  let lastFadeMode = 'unset';

  // Continuous Droste dive — one global d drives every clone. Each clone's
  // role rotates through the full life cycle (tiny emergent → peak → grown
  // past peak → escape) as d advances; modular arithmetic makes the
  // rotation seamless because the wraparound happens where opacity is
  // already zero.
  //
  // `opacityMul` is the global cloneOp envelope (1 during dive, 0 in static).
  // `fadeMode`: 'fadeIn' = 1→0, 'fadeOut' = 0→1, 'steady' = no per-clone
  // stagger applied (used during dive; only landing/intro engage stagger).
  function applyDive(d, opacityMul = 1.0, fadeMode = 'steady') {
    const cfg = ANIM.fractalZoom || {};
    const N = clones.length;
    if (N === 0) return;

    // Fully-faded fast path. Hide every pivot and skip the per-clone
    // sweep. Three.js then culls them so we save 5× draw calls.
    if (opacityMul <= 1e-4) {
      if (!(lastDiveOp <= 1e-4)) {
        for (let k = 0; k < N; k++) {
          const c = clones[k];
          c.pivot.visible = false;
          c.pivot.matrixWorldAutoUpdate = false;
        }
      }
      lastDiveOp = 0;
      return;
    }
    // Loose d-cache: 5e-4 step at growthFactor ≈ 2.2 is a sub-pixel scale
    // change — cuts applyDive out entirely on most slow-segment frames.
    if (Math.abs(d - lastDiveD) < 5e-4 &&
        Math.abs(opacityMul - lastDiveOp) < 1e-3 &&
        fadeMode === lastFadeMode) return;
    lastDiveD    = d;
    lastDiveOp   = opacityMul;
    lastFadeMode = fadeMode;

    const scaleF = cfg.cloneScaleFactor ?? 0.5;
    const g      = 1 / Math.max(scaleF, 0.05);   // growth factor between layers
    const sigma  = Math.max(cfg.droSigma ?? 0.45, 1e-3);
    const rotPer = cfg.droLayerRotation ?? 0.0;
    const half   = N * 0.5;
    const lnG    = Math.log(g);
    const revealSpread    = Math.min(0.95, Math.max(0, cfg.revealStaggerSpread ?? 0.0));
    const revealOvershoot = Math.max(0, cfg.revealOvershoot ?? 0.0);
    const fadeStagger     = Math.min(0.95, Math.max(0, cfg.cloneFadeStagger ?? 0.0));
    const clampPastPeak   = !!cfg.clampPastPeak;   // debug A/B knob

    for (let k = 0; k < N; k++) {
      // Each clone's effective depth wraps modulo N into [-N/2, N/2).
      // Subtracting k staggers them by one Droste step apiece.
      let r = ((d - k + half) % N + N) % N - half;
      const c = clones[k];
      if (clampPastPeak && r > 0) {
        c.pivot.visible = false;
        c.pivot.matrixWorldAutoUpdate = false;
        c.lastRevealMode = 'hidden';
        continue;
      }
      const scale = Math.pow(g, r);
      // Gaussian opacity envelope around scale = 1 (r = 0). At r = ±N/2
      // opacity ≈ 0 — that's where the modular wraparound happens, hiding
      // the seam.
      const logS = r * lnG;
      let op = Math.exp(-(logS / sigma) * (logS / sigma)) * opacityMul;

      // Per-clone fade stagger (only during landing/intro fades). Shallow
      // clones (|r| close to 0) lead the crossfade; deeper clones lag by
      // up to `fadeStagger` of the window. The global cloneOp is already
      // eased, so we apply a plain smoothstep per-clone.
      if (fadeStagger > 0 && fadeMode !== 'steady') {
        const rNorm = Math.min(1, Math.abs(r) / Math.max(half, 1e-4));
        const shift = rNorm * fadeStagger;
        let local = (opacityMul - shift) / Math.max(1e-3, 1 - shift);
        if (local <= 0)      local = 0;
        else if (local >= 1) local = 1;
        else                 local = local * local * (3 - 2 * local);
        const baseEnv = Math.exp(-(logS / sigma) * (logS / sigma));
        op = baseEnv * local;
      }

      // Hide essentially-invisible clones so three.js skips draw calls.
      if (op < 0.02) {
        c.pivot.visible = false;
        c.pivot.matrixWorldAutoUpdate = false;
        c.lastRevealMode = 'hidden';
        continue;
      }
      c.pivot.visible = true;
      c.pivot.matrixWorldAutoUpdate = true;
      c.pivot.scale.set(scale, scale, 1);
      c.pivot.rotation.z = rotPer * r;
      c.cloneScaleUniform.value = Math.max(scale, 0.001);
      for (let i = 0; i < c.fadeables.length; i++) {
        const f = c.fadeables[i];
        if (f.kind === 'uniform') f.mat.uniforms.uMaxOpacity.value = f.base * op;
        else                      f.mat.opacity                    = f.base * op;
      }

      // Per-tile reveal stagger inside this clone. As the pivot scale
      // grows from 0 toward 1, each tile's LOCAL scale ramps from 0 → 1
      // on its own curve, with `revealPhase` (0 = innermost, 1 = outer
      // ring) controlling how late it joins. Outer tiles DON'T finish at
      // scale=1 — they finish PAST it (by `revealOvershoot`), so when the
      // clone first reaches scale=1 the gate-frame silhouette is NOT
      // outlined by a wall of full-size rosettes.
      if (revealSpread <= 0) {
        if (c.lastRevealMode !== 'full-norevealcfg') {
          for (let i = 0; i < c.revealTiles.length; i++) {
            const rt = c.revealTiles[i];
            rt.mesh.scale.set(rt.baseScaleX, rt.baseScaleY, rt.baseScaleZ);
          }
          c.lastRevealMode = 'full-norevealcfg';
        }
      } else if (scale >= 1.0 + revealOvershoot) {
        if (c.lastRevealMode !== 'full') {
          for (let i = 0; i < c.revealTiles.length; i++) {
            const rt = c.revealTiles[i];
            rt.mesh.scale.set(rt.baseScaleX, rt.baseScaleY, rt.baseScaleZ);
          }
          c.lastRevealMode = 'full';
        }
      } else {
        // Skip the per-tile sweep if scale moved less than ~0.3% since
        // the last 'growing' frame — sub-pixel change.
        if (c.lastRevealMode === 'growing' &&
            Math.abs(scale - c.lastRevealScale) < 0.003) {
          // cached frame
        } else {
          for (let i = 0; i < c.revealTiles.length; i++) {
            const rt = c.revealTiles[i];
            const t0  = rt.revealPhase * revealSpread;
            const t1  = 1 + rt.revealPhase * revealOvershoot;
            const den = t1 - t0;
            let f = den > 1e-4 ? (scale - t0) / den : 1;
            if (f <= 0) {
              rt.mesh.scale.set(0, 0, rt.baseScaleZ);
              continue;
            }
            if (f >= 1) f = 1;
            else {
              f = f * f * (3 - 2 * f);
              if (rt.speed !== 1) f = Math.pow(f, 1 / rt.speed);
            }
            rt.mesh.scale.set(rt.baseScaleX * f, rt.baseScaleY * f, rt.baseScaleZ);
          }
          c.lastRevealScale = scale;
        }
        c.lastRevealMode = 'growing';
      }
    }
  }

  function updateFractalZoom(t /*, dt */) {
    const cfg = ANIM.fractalZoom;
    // Bail in any non-fractal-pattern mode: snap to clean rest, clear
    // accumulated opacity on both originals and clones, re-arm the
    // initial-settle wait for the next entry.
    if (!cfg || cfg.enabled === false || ANIM.viewMode !== 'fractalPattern') {
      if (fractalRoot.visible) {
        fractalRoot.visible = false;
        parkOriginalTiles();
        parkAllClones();
        fadeOriginals(1);
      }
      fractalState.phase      = 'rest';
      fractalState.phaseStart = t;
      fractalState.firstRest  = true;
      fractalState.lambda     = 0;
      fractalState.diveD      = 0;
      fractalState.cloneOp    = 0;
      fractalState.active     = 1;
      return;
    }

    fractalRoot.visible = true;

    // Refresh shared clone-scale-fade uniforms from config so the knobs
    // are live-editable.
    cloneScaleFadeStartUniform.value = cfg.cloneScaleFadeStart ?? 1.5;
    cloneScaleFadeEndUniform.value   = cfg.cloneScaleFadeEnd   ?? 3.0;

    const introDur   = cfg.introDuration   ?? 4.0;
    const stepDur    = cfg.droStepDuration ?? 4.0;
    const diveDur    = cfg.diveDuration    ?? 12.0;
    const landingDur = cfg.landingDuration ?? 2.0;
    const trigDel    = cfg.triggerDelay    ?? 5.0;
    const loopDur    = cfg.loopStaticDur   ?? 10.0;
    const elapsed    = t - fractalState.phaseStart;

    if (fractalState.phase === 'rest') {
      parkOriginalTiles();
      parkAllClones();
      fadeOriginals(1);
      fractalState.lambda  = 0;
      fractalState.diveD   = 0;
      fractalState.cloneOp = 0;
      fractalState.active  = 1;
      const firstRest = fractalState.firstRest !== false;
      const dwellDur  = firstRest ? trigDel : loopDur;
      if (dwellDur > 0 && elapsed >= dwellDur) {
        fractalState.firstRest  = false;
        fractalState.phase      = 'intro';
        fractalState.phaseStart = t;
      }
      return;
    }

    if (fractalState.phase === 'intro') {
      const u = Math.min(1, elapsed / Math.max(introDur, 1e-3));
      const s = smoothstep(u);
      const cloneOp = s;
      const d       = s;
      parkOriginalTiles();
      fadeOriginals(Math.max(0, 1 - cloneOp));
      applyDive(d, cloneOp, 'steady');
      fractalState.lambda  = 0;
      fractalState.diveD   = d;
      fractalState.cloneOp = cloneOp;
      fractalState.active  = Math.max(0, 1 - cloneOp);
      if (u >= 1) {
        fractalState.phase      = 'dive';
        fractalState.phaseStart = t;
        fractalState.diveD0     = 1;
      }
      return;
    }

    if (fractalState.phase === 'dive') {
      const startD = fractalState.diveD0 ?? 1;
      const stepsToCover = Math.max(1, Math.ceil(diveDur / Math.max(stepDur, 1e-3)));
      const targetD = Math.round(startD + stepsToCover);
      const segDur  = (targetD - startD) * Math.max(stepDur, 1e-3);
      const u = Math.min(1, elapsed / Math.max(segDur, 1e-3));
      const d = startD + (targetD - startD) * smoothstep(u);
      parkOriginalTiles();
      fadeOriginals(0);
      applyDive(d, 1, 'steady');
      fractalState.lambda  = 0;
      fractalState.diveD   = d;
      fractalState.cloneOp = 1;
      fractalState.active  = 0;
      if (u >= 1) {
        // Hand off to landing crossfade (or atomic swap if landingDur=0).
        // d is now exactly at `targetD` (an integer), so the at-peak
        // clone sits at scale 1 / op 1 — pixel-identical to rest.
        if (landingDur > 0) {
          fractalState.phase      = 'landing';
          fractalState.phaseStart = t;
          fractalState.diveD0     = targetD;
        } else {
          fractalState.phase      = 'rest';
          fractalState.phaseStart = t;
        }
      }
      return;
    }

    if (fractalState.phase === 'landing') {
      // Crossfade out of the dive into the rest pattern. d held at the
      // integer target so the at-peak clone stays at scale 1 throughout.
      // cloneOp ramps 1 → 0 with `fadeMode: 'fadeIn'`, engaging
      // cloneFadeStagger so deeper clones fade out FIRST. Originals fade
      // back in on the same smoothstep.
      const u = Math.min(1, elapsed / Math.max(landingDur, 1e-3));
      const s = smoothstep(u);
      const cloneOp = 1 - s;
      const d = fractalState.diveD0 ?? 1;
      parkOriginalTiles();
      fadeOriginals(s);
      applyDive(d, cloneOp, 'fadeIn');
      fractalState.lambda  = 0;
      fractalState.diveD   = d;
      fractalState.cloneOp = cloneOp;
      // Sparks ramp back as originals reappear.
      fractalState.active  = s;
      if (u >= 1) {
        fractalState.phase      = 'rest';
        fractalState.phaseStart = t;
      }
      return;
    }

    // Defensive: unknown phase → reset.
    fractalState.phase      = 'rest';
    fractalState.phaseStart = t;
  }

  return { updateFractalZoom, fractalState };
}
