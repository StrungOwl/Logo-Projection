// Gate-frame rim — same buildFlameRim ribbon system the central flame
// uses on its inner-star cutout, but here the polygon is the gate-frame's
// inner aperture (the entire logo silhouette inset by gateFrameWidth).
// Only shown in flameOnly mode (key 6); main.js toggles .visible. The
// per-frame driver mirrors flame.js's chase/ignite scheduler.
//
// Returns { gateRimGroup, updateGateRim } — both null when the rim is
// disabled in config or the build fails.

import * as THREE from 'three';
import { ANIM } from '../../config.js';
import { insetPolygon } from '../../util/polygon.js';
import { buildFlameRim } from '../fireplaceOne/flame.js';

export function createGateRim({ logoMesh, gateOutline, gateFrameWidth, cx, cy, maxZ }) {
  const gateRimCfg = ANIM.flame && ANIM.flame.gateRim;
  let gateRimGroup = null;
  let updateGateRim = null;
  try {
    if (gateRimCfg && gateRimCfg.enabled !== false) {
      const innerOffset = gateRimCfg.inset || 0;
      const gateInnerLoop = insetPolygon(gateOutline, gateFrameWidth + innerOffset);
      let gateMinY = Infinity;
      let gateLaunchX = 0;
      for (const p of gateInnerLoop) {
        if (p.y < gateMinY) { gateMinY = p.y; gateLaunchX = p.x; }
      }
      const rim = buildFlameRim({
        cutoutLoop: gateInnerLoop,
        zCenter:    0,
        vpX:        gateLaunchX,
        minY:       gateMinY,
        cfg:        { rim: gateRimCfg },
      });
      if (rim) {
        gateRimGroup = new THREE.Group();
        gateRimGroup.name = 'gate-rim';
        // Sit slightly in front of the gate frame's front face so the
        // additive ribbon glows ON the metal rather than getting depth-
        // culled behind it. Gate frame extrudes 1.5 + 0.22 lip from
        // maxZ + 0.45.
        gateRimGroup.position.set(cx, cy, maxZ + 2.2);
        gateRimGroup.visible = false;
        gateRimGroup.add(rim.mesh);
        logoMesh.add(gateRimGroup);

        let pulseStart  = -1, pulseEnd  = -1;
        let igniteStart = -1, igniteEnd = -1;
        const pulseColorVec  = new THREE.Vector3();
        const igniteColorVec = new THREE.Vector3();

        updateGateRim = (t, dt) => {
          const rcfg    = ANIM.flame.gateRim || {};
          const rPulse  = rcfg.pulse  || {};
          const rIgnite = rcfg.ignite || {};

          if (rPulse.enabled !== false && rPulse.rate > 0 && t > pulseEnd) {
            if (Math.random() < rPulse.rate * dt) {
              pulseStart = t;
              pulseEnd   = t + (rPulse.duration ?? 6.0);
              if (rPulse.color) {
                const c = new THREE.Color(rPulse.color);
                pulseColorVec.set(c.r, c.g, c.b);
                rim.uniforms.uPulseColor.value.copy(pulseColorVec);
              }
            }
          }
          if (t >= pulseStart && t <= pulseEnd) {
            const dur = Math.max((rPulse.duration ?? 6.0), 0.01);
            const u   = (t - pulseStart) / dur;
            const phase = (rim.launchS + u) % 1;
            rim.uniforms.uPulsePhase.value = (phase + 1) % 1;
            rim.uniforms.uPulseWidth.value = rPulse.width ?? 0.08;
            const env = u < 0.10 ? (u / 0.10)
                                  : Math.max(0, 1.0 - (u - 0.10) / 0.90);
            rim.uniforms.uPulseEnv.value = env * (rPulse.intensity ?? 3.0);
          } else {
            rim.uniforms.uPulseEnv.value = 0;
          }

          if (rIgnite.enabled !== false && rIgnite.rate > 0 && t > igniteEnd) {
            if (Math.random() < rIgnite.rate * dt) {
              igniteStart = t;
              igniteEnd   = t + (rIgnite.duration ?? 5.0);
              if (rIgnite.color) {
                const c = new THREE.Color(rIgnite.color);
                igniteColorVec.set(c.r, c.g, c.b);
                rim.uniforms.uIgniteColor.value.copy(igniteColorVec);
              }
              rim.uniforms.uIgniteCenter.value = rim.launchS;
            }
          }
          if (t >= igniteStart && t <= igniteEnd) {
            const dur = Math.max((rIgnite.duration ?? 5.0), 0.01);
            const u   = (t - igniteStart) / dur;
            const maxSpread = Math.min(rIgnite.maxSpread ?? 0.55, 0.55);
            const spread = 0.005 + maxSpread * Math.min(u * 2.0, 1.0);
            const env = u < 0.30 ? (u / 0.30)
                                  : Math.max(0, 1.0 - (u - 0.30) / 0.70);
            rim.uniforms.uIgniteSpread.value = spread;
            rim.uniforms.uIgniteEnv.value    = env * (rIgnite.intensity ?? 2.4);
          } else {
            rim.uniforms.uIgniteEnv.value = 0;
          }
        };
      }
    }
  } catch (e) {
    console.error('[gateRim] build failed:', e);
    gateRimGroup = null;
    updateGateRim = null;
  }
  return { gateRimGroup, updateGateRim };
}
