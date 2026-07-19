// Config-driven wrapper around createSparkSystem. effects.js builds four
// near-identical spark systems (panel / lattice / central / arch) that
// differ only in ANIM config key, host group, fade radius, and z — this
// factory owns the cfg → createSparkSystem mapping so those call sites
// stay four short blocks.
//
// Creation order at the call sites is load-bearing: createSparkSystem
// consumes Math.random while seeding sparks, and the verify probe seeds
// the global RNG — so callers must invoke makeSparks in a fixed order.
//
// startDelay / startDelayMax / brightness are forwarded unconditionally;
// configs without those keys pass undefined, which hits the same
// createSparkSystem destructuring defaults (0 / null / 1) as omitting
// them entirely.

import { createSparkSystem } from './sparks.js';

export function makeSparks({ cfg, patternGroup, host, fadeCenter, fadeOuter, z }) {
  const sparks = createSparkSystem({
    patternGroup,
    fadeCenter,
    fadeOuter,
    count:            cfg.count,
    gravity:          cfg.gravity,
    maxSpeed:         cfg.maxSpeed,
    damping:          cfg.damping,
    snapStrength:     cfg.snapStrength,
    tangentialFactor: cfg.tangentialFactor,
    speedVariance:    cfg.speedVariance,
    sizeVariance:     cfg.sizeVariance,
    color:            cfg.color,
    hueVariance:      cfg.hueVariance,
    pointSize:        cfg.pointSize,
    trailSize:        cfg.trailSize,
    startDelay:       cfg.startDelay,
    startDelayMax:    cfg.startDelayMax,
    brightness:       cfg.brightness,
    z,
  });
  patternGroup.add(sparks.points);
  sparks.host = host;
  return sparks;
}
