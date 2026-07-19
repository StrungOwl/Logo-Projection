// Shared onBeforeCompile helpers for the pattern effects.
//
// The hull-clip and radial-fade fragment-shader injections were originally
// duplicated verbatim between hexagons/hexagons.js and
// fractalPattern/fractalPattern.js (and fractalZoom.js splices into the
// fade's final alpha line by exact-string replace). The builders below
// reproduce those injections byte-for-byte — fractalZoom's replace anchors
// and the compiled GPU programs depend on the exact text, so any edit here
// must keep the emitted GLSL identical at every call site.

// Compose `fn` AFTER any existing material.onBeforeCompile — the previous
// callback runs first, then `fn`, both receiving (shader, renderer).
//
// No customProgramCacheKey composition: nothing in this codebase sets
// material.customProgramCacheKey, so three.js keys the program cache on
// onBeforeCompile.toString(), and each composed closure yields its own
// distinct key. If a patch ever starts setting customProgramCacheKey,
// compose it here the same way.
export function chainOnBeforeCompile(material, fn) {
  const prior = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prior) prior(shader, renderer);
    fn(shader, renderer);
  };
  return material;
}

// Hull-clip injection — hard-clips fragments to a polygon's interior via
// an even-odd ray cast against packed edges (handles concave outline +
// interior holes). Accepts either a single polygon (array of {x,y}) or a
// list of loops [outer CCW, hole CW, ...].
//
// Returns { uniforms, glslCommon, glslCall }:
//   uniforms   — { uHullEdges } to Object.assign into shader.uniforms
//                (null when no usable loops → glsl strings are '').
//   glslCommon — #define + uniform declaration, spliced into the fragment
//                shader's <common> block.
//   glslCall   — the discard test, spliced where the clip should run.
//                Reads vPanelXY, which the call site's vertex patch must
//                provide.
// Both consumers use the same define / uniform / varying names, so none
// are parameterized — the emitted text matches the original files exactly.
export function buildHullClip(polygonLoops) {
  let hullEdges = null;
  let hullEdgeCount = 0;
  if (polygonLoops && polygonLoops.length > 0) {
    const loops = (polygonLoops[0] && 'x' in polygonLoops[0])
      ? [polygonLoops] : polygonLoops;
    let total = 0;
    for (const loop of loops) if (loop && loop.length >= 3) total += loop.length;
    if (total > 0) {
      hullEdges = new Float32Array(total * 4);
      let off = 0;
      for (const loop of loops) {
        if (!loop || loop.length < 3) continue;
        for (let i = 0; i < loop.length; i++) {
          const a = loop[i];
          const b = loop[(i + 1) % loop.length];
          hullEdges[off++] = a.x;
          hullEdges[off++] = a.y;
          hullEdges[off++] = b.x;
          hullEdges[off++] = b.y;
        }
      }
      hullEdgeCount = total;
    }
  }
  const uniforms = hullEdges
    ? { uHullEdges: { value: hullEdges } }
    : null;
  const glslCommon = hullEdges
    ? `
      #define HULL_EDGE_COUNT ${hullEdgeCount}
      uniform vec4 uHullEdges[HULL_EDGE_COUNT];`
    : '';
  const glslCall = hullEdges
    ? `
      int _ci = 0;
      for (int _ei = 0; _ei < HULL_EDGE_COUNT; _ei++) {
        vec4 _e = uHullEdges[_ei];
        bool _ay = _e.y > vPanelXY.y;
        bool _by = _e.w > vPanelXY.y;
        if (_ay != _by) {
          float _xc = (_e.z - _e.x) * (vPanelXY.y - _e.y) / (_e.w - _e.y) + _e.x;
          if (vPanelXY.x < _xc) _ci++;
        }
      }
      if (_ci - (_ci / 2) * 2 == 0) discard;`
    : '';
  return { uniforms, glslCommon, glslCall };
}

// Final alpha statements of the radial-fade blocks. fractalZoom.js
// exact-string-replaces these lines to append its clone-scale fade, so
// they are exported as the single source of truth for that anchor text.
export const RADIAL_FADE_ALPHA_BODY   = 'gl_FragColor.a *= _a * uMaxOpacity;';
export const RADIAL_FADE_ALPHA_STROKE = 'gl_FragColor.a *= _a * uMaxOpacity * _twinkle;';

// Radial-fade injection — spliced after <dithering_fragment>. Fades
// alpha from 0 inside uFadeInner to uMaxOpacity beyond uFadeOuter,
// measured from uFadeCenter in panel-local coords, with a downward
// stretch + bottom taper shaping the fade zone. Two variants:
//   'body'   — fill materials. Symmetric vertical stretch (abs), plain
//              uMaxOpacity alpha.
//   'stroke' — line materials. Stretch below center only, plus the
//              per-instance twinkle flicker (uTime / uTwinkleSeed).
// `indent` = column of the call site's template-literal continuation
// lines, so the emitted block is byte-identical to the original inlined
// text (first line carries no indent — the call site's `${...}` supplies
// it).
export function buildRadialFade({ variant = 'body', indent = 9 } = {}) {
  const lines = variant === 'stroke'
    ? [
        'vec2  _delta = vPanelXY - uFadeCenter;',
        'if (_delta.y < 0.0) _delta.y /= max(uFadeDownStretch, 1e-4);',
        'float _downN = clamp(-_delta.y / max(uFadeOuter, 1e-4), 0.0, 2.0);',
        '_delta.x *= 1.0 + uFadeBottomTaper * _downN;',
        'float _d = length(_delta);',
        'float _a = (uFadeOuter > uFadeInner)',
        '   ? smoothstep(uFadeInner, uFadeOuter, _d)',
        '   : 1.0;',
        '// Per-instance twinkle: two sine waves offset by a random seed',
        '// give a non-periodic-feeling flicker from 0 to full brightness.',
        'float _t1 = sin(uTime * 1.2 + uTwinkleSeed);',
        'float _t2 = sin(uTime * 0.7 + uTwinkleSeed * 2.3);',
        'float _twinkle = clamp(0.5 + 0.65 * (_t1 * 0.6 + _t2 * 0.4), 0.0, 1.0);',
        RADIAL_FADE_ALPHA_STROKE,
      ]
    : [
        'vec2  _delta = vPanelXY - uFadeCenter;',
        '_delta.y /= max(uFadeDownStretch, 1e-4);',
        'float _downN = clamp(abs(_delta.y) / max(uFadeOuter, 1e-4), 0.0, 2.0);',
        '_delta.x *= 1.0 + uFadeBottomTaper * _downN;',
        'float _d = length(_delta);',
        'float _a = (uFadeOuter > uFadeInner)',
        '   ? smoothstep(uFadeInner, uFadeOuter, _d)',
        '   : 1.0;',
        RADIAL_FADE_ALPHA_BODY,
      ];
  return lines.join('\n' + ' '.repeat(indent));
}
