// Constellation overlay — visible only in flameOnly mode (key 6). Lays
// out a recognisable celestial figure (Ursa Major / Big Dipper) inside
// the logo silhouette: 7 stars in canonical relative positions, joined
// by 7 lines that trace bowl + handle. Every star and every line is
// validated against the silhouette polygon (outer loop + interior
// cutouts) so the figure never spills past the frame or crosses the
// inner-star negative space.
//
// Lines fade in one at a time over ~10 s, then settle to a quiet
// persistent thread so the figure blends into the starfield rather
// than dominating it.
//
// Every ~45–75 s a stellar pulse fires: an inward shockwave contracts
// from the silhouette to the inner-star centroid, brightening anchors
// and their connecting lines as the wavefront passes; the anchors also
// streak briefly toward the centroid and return.

import * as THREE from 'three';
import { LineSegments2 }        from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial }         from 'three/addons/lines/LineMaterial.js';
import { pointInPolygon }       from '../../util/polygon.js';

// True if (x,y) lies in the visible (positive) region of the logo —
// inside the outer silhouette loop and outside every interior cutout.
function isInsideVisibleArea(x, y, polys) {
  if (!pointInPolygon(x, y, polys[0])) return false;
  for (let i = 1; i < polys.length; i++) {
    if (pointInPolygon(x, y, polys[i])) return false;
  }
  return true;
}

// Walk the segment from (ax,ay)→(bx,by) at `samples` evenly-spaced
// points and bail out the moment any sample falls outside the visible
// area. Used to guarantee no constellation edge crosses a cutout
// (inner-star hole, foot slit) or pokes past the outer silhouette.
function segmentInsideArea(ax, ay, bx, by, polys, samples = 32) {
  for (let i = 0; i <= samples; i++) {
    const u = i / samples;
    const x = ax + (bx - ax) * u;
    const y = ay + (by - ay) * u;
    if (!isInsideVisibleArea(x, y, polys)) return false;
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────
// Celestial figure library — each entry has stars in canonical relative
// coords (x ∈ [0,1] left→right, y ∈ [0,1] bottom→top) plus a list of
// edge pairs by index. The cycle picks 5 of these in order, placing
// each in a different region of the silhouette.
// ─────────────────────────────────────────────────────────────────────
const FIGURES = {
  // Ursa Major — Big Dipper asterism, 7 main stars. Bowl on the right
  // sits as a trapezoid; handle curves leftward and slightly downward
  // from Megrez through Alioth, Mizar, to Alkaid (the dip is real, not
  // a straight line). Edges follow the standard chart convention.
  ursaMajor: {
    name: 'Ursa Major',
    stars: [
      [0.97, 0.68],  // 0 Dubhe   — top-front of bowl
      [0.97, 0.40],  // 1 Merak   — bottom-front of bowl
      [0.74, 0.32],  // 2 Phecda  — bottom-back of bowl
      [0.78, 0.58],  // 3 Megrez  — top-back of bowl (handle root)
      [0.56, 0.62],  // 4 Alioth  — first handle star
      [0.32, 0.58],  // 5 Mizar   — mid handle (with companion Alcor)
      [0.05, 0.42],  // 6 Alkaid  — handle tip (drops below the bowl line)
    ],
    edges: [
      [0, 1], [1, 2], [2, 3], [3, 0],  // bowl
      [3, 4], [4, 5], [5, 6],           // handle
    ],
  },

  // Cassiopeia — classic W of 5 bright stars. Peaks at top, valleys at
  // bottom. Position γ (the centre peak) slightly lower than Caph/Segin
  // (the outer peaks), matching the real chart's asymmetry.
  cassiopeia: {
    name: 'Cassiopeia',
    stars: [
      [0.00, 0.78],  // 0 β Cas (Caph)     — top-left peak
      [0.25, 0.10],  // 1 α Cas (Schedar)  — left valley
      [0.52, 0.65],  // 2 γ Cas            — centre peak (slightly lower)
      [0.78, 0.18],  // 3 δ Cas (Ruchbah)  — right valley
      [1.00, 0.85],  // 4 ε Cas (Segin)    — top-right peak
    ],
    edges: [[0,1],[1,2],[2,3],[3,4]],
  },

  // Cygnus — Northern Cross asterism inside the Swan. 6 stars: the
  // 5-star cross (Deneb-Sadr-Albireo spine, δ + ε wings) plus η Cyg
  // on the spine between Sadr and Albireo so the swan's neck reads.
  // Wings tilt slightly — δ a touch above centre, ε a touch below —
  // matching the real chart.
  cygnus: {
    name: 'Cygnus',
    stars: [
      [0.50, 1.00],  // 0 Deneb   (tail / top of cross)
      [0.08, 0.66],  // 1 δ Cyg   (left wing tip, raised)
      [0.50, 0.55],  // 2 Sadr    (centre / body)
      [0.92, 0.42],  // 3 ε Cyg   (right wing tip, dipped)
      [0.50, 0.28],  // 4 η Cyg   (neck)
      [0.50, 0.00],  // 5 Albireo (head / bottom of cross)
    ],
    edges: [
      [0, 2],  // tail → body
      [1, 2],  // left wing → body
      [2, 3],  // body → right wing
      [2, 4],  // body → neck
      [4, 5],  // neck → head
    ],
  },

  // Orion — full hunter figure: head (Meissa), shoulders (Betelgeuse,
  // Bellatrix), belt (3 stars), feet (Rigel, Saiph), and the sword
  // hanging below the belt (2 stars). 9 stars total, 11 edges. This is
  // the canonical figure most charts draw.
  orion: {
    name: 'Orion',
    stars: [
      [0.50, 1.00],  // 0 Meissa     (head)
      [0.68, 0.82],  // 1 Betelgeuse (right shoulder)
      [0.32, 0.85],  // 2 Bellatrix  (left shoulder)
      [0.34, 0.52],  // 3 Mintaka    (belt left)
      [0.50, 0.50],  // 4 Alnilam    (belt centre)
      [0.66, 0.48],  // 5 Alnitak    (belt right)
      [0.22, 0.05],  // 6 Rigel      (left foot)
      [0.78, 0.10],  // 7 Saiph      (right foot)
      [0.48, 0.34],  // 8 sword top  (42 Ori area)
      [0.46, 0.22],  // 9 sword tip  (ι Ori area)
    ],
    edges: [
      [0, 1], [0, 2], [1, 2],  // head + shoulders triangle
      [2, 3], [1, 5],          // shoulders → belt outer
      [3, 4], [4, 5],          // belt
      [3, 6], [5, 7],          // belt → feet
      [4, 8], [8, 9],          // belt → sword
    ],
  },

  // Lyra — Vega plus the parallelogram of ε, ζ, β, γ Lyr. Vega connects
  // to BOTH top corners of the parallelogram for the "harp string" look.
  lyra: {
    name: 'Lyra',
    stars: [
      [0.50, 1.00],  // 0 Vega
      [0.28, 0.66],  // 1 ε Lyr   (top-left of parallelogram)
      [0.72, 0.70],  // 2 ζ Lyr   (top-right of parallelogram)
      [0.18, 0.12],  // 3 β Lyr   (bottom-left)
      [0.80, 0.08],  // 4 γ Lyr   (bottom-right)
    ],
    edges: [
      [0, 1], [0, 2],   // Vega to top of parallelogram
      [1, 3],            // left side
      [2, 4],            // right side
      [3, 4],            // bottom
      [1, 2],            // top of parallelogram
    ],
  },
};

// Map canonical stars to mesh-local positions using a centre + scale +
// rotation, then validate every star is inside the visible area AND
// every edge's interior stays inside. Returns null if validation fails.
function tryPlaceConstellation(figure, polys, cx, cy, scale, rotation) {
  const cos = Math.cos(rotation), sin = Math.sin(rotation);
  const stars = figure.stars.map(([px, py]) => {
    const dx = (px - 0.5) * scale;
    const dy = (py - 0.5) * scale;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos,
    };
  });
  for (const s of stars) {
    if (!isInsideVisibleArea(s.x, s.y, polys)) return null;
  }
  for (const [a, b] of figure.edges) {
    if (!segmentInsideArea(stars[a].x, stars[a].y, stars[b].x, stars[b].y, polys, 32)) {
      return null;
    }
  }
  return stars;
}

// Place a figure using its preferred candidate list, then a generic
// shrink-and-retry fallback at the same centre. Returns { stars, edges,
// candidate } or null.
function placeFigure(figure, polys, candidates) {
  for (const c of candidates) {
    const stars = tryPlaceConstellation(figure, polys, c.cx, c.cy, c.scale, c.rot || 0);
    if (stars) return { stars, edges: figure.edges.map(([a, b]) => ({ a, b })), candidate: c };
  }
  // Last-ditch: shrink the first candidate's scale.
  if (candidates.length) {
    const c0 = candidates[0];
    for (let s = c0.scale * 0.8; s >= c0.scale * 0.3; s *= 0.85) {
      const stars = tryPlaceConstellation(figure, polys, c0.cx, c0.cy, s, c0.rot || 0);
      if (stars) {
        return { stars, edges: figure.edges.map(([a, b]) => ({ a, b })), candidate: { ...c0, scale: s } };
      }
    }
  }
  return null;
}

// Build the 5-figure sequence with each placement validated against the
// silhouette. Each entry uses a region of the silhouette so the eye sees
// the figure move around the frame as the cycle progresses.
function buildSequence(polys) {
  // Bbox of outer silhouette — used to anchor placements relative to
  // the actual frame dimensions.
  let xmin =  Infinity, xmax = -Infinity, ymin = Infinity, ymax = -Infinity;
  for (const p of polys[0]) {
    if (p.x < xmin) xmin = p.x;
    if (p.x > xmax) xmax = p.x;
    if (p.y < ymin) ymin = p.y;
    if (p.y > ymax) ymax = p.y;
  }
  const w = xmax - xmin, h = ymax - ymin;
  const domeY = ymax - h * 0.20;             // upper-dome safe band
  const lowerY = ymin + h * 0.27;            // upper part of feet
  const footX  = w * 0.16;                   // ±x for left/right feet

  // (figure, region, [candidates]) tuples — order = on-screen sequence.
  // Each constellation lands in a DIFFERENT silhouette region so the
  // viewer's eye is pulled around the frame across the cycle.
  const plan = [
    {
      figure: FIGURES.ursaMajor,
      region: 'upper dome',
      candidates: [
        { cx: 0, cy: domeY, scale: w * 0.38 },
        { cx: 0, cy: domeY, scale: w * 0.32 },
        { cx: 0, cy: domeY, scale: w * 0.26 },
      ],
    },
    {
      figure: FIGURES.cygnus,
      region: 'left foot',
      candidates: [
        { cx: -footX, cy: lowerY - h * 0.10, scale: w * 0.28 },
        { cx: -footX, cy: lowerY,            scale: w * 0.22 },
        { cx: -footX, cy: lowerY + h * 0.05, scale: w * 0.18 },
      ],
    },
    {
      figure: FIGURES.cassiopeia,
      region: 'upper-right dome',
      candidates: [
        { cx:  w * 0.18, cy: domeY, scale: w * 0.22 },
        { cx:  w * 0.15, cy: domeY, scale: w * 0.18 },
        { cx:  w * 0.12, cy: domeY, scale: w * 0.16 },
      ],
    },
    {
      figure: FIGURES.orion,
      region: 'right foot',
      candidates: [
        { cx:  footX, cy: lowerY - h * 0.12, scale: w * 0.28 },
        { cx:  footX, cy: lowerY,            scale: w * 0.22 },
        { cx:  footX, cy: lowerY + h * 0.05, scale: w * 0.18 },
      ],
    },
    {
      figure: FIGURES.lyra,
      region: 'upper-left dome',
      candidates: [
        { cx: -w * 0.18, cy: domeY, scale: w * 0.22 },
        { cx: -w * 0.15, cy: domeY, scale: w * 0.18 },
        { cx: -w * 0.12, cy: domeY, scale: w * 0.16 },
      ],
    },
  ];

  const sequence = [];
  for (const entry of plan) {
    const placed = placeFigure(entry.figure, polys, entry.candidates);
    if (placed) {
      console.log(`[constellation] ${entry.figure.name} placed in ${entry.region}: (${placed.candidate.cx.toFixed(1)},${placed.candidate.cy.toFixed(1)}) scale ${placed.candidate.scale.toFixed(1)}`);
      sequence.push({ figure: entry.figure, stars: placed.stars, edges: placed.edges });
    } else {
      console.warn(`[constellation] could not place ${entry.figure.name} in ${entry.region} — skipping`);
    }
  }
  return sequence;
}

export function createConstellation({
  silhouettePolygons,        // mesh-local outer + cutout polygons
  fadeCenter,                // [x, y] in same space, inner-star centroid
  hullMaxR,                  // max anchor radius from fadeCenter
  renderer,
  // Visual look — white, very subtle, blends into the starfield.
  color               = 0xFFFFFF,
  baseLinewidth       = 1.0,
  pointSize           = 5.5,        // screen pixels (pre-pixelRatio)
  drawIntervalMin     = 0.8,
  drawIntervalMax     = 1.5,
  drawDuration        = 1.3,
  persistentOpacity   = 0.10,       // line settle brightness — even quieter
  pointBaseBright     = 0.80,
  flareIntensity      = 0.55,
  flareDuration       = 0.7,
  // Per-constellation pulse event (within the pulsing phase)
  pulseDuration       = 4.0,
  pulseWavefrontWidth = 4.5,
  pulseConvergeDist   = 0.9,
  pulseBoostIntensity = 1.4,
  // Cycle phase durations
  initialDelay        = 20.0,       // seconds in flameOnly before first figure
  pulsingDuration     = 10.0,       // hold + pulse window
  fadingDuration      = 2.0,        // line/star fade out
  gapDuration         = 5.0,        // rest period — pure starry sky between figures
  drawingMaxDuration  = 14.0,       // safety cap if draws stall
  pulseTriggerDelay   = 2.5,        // seconds into pulsing phase before pulse fires
  // After all 5 figures fade out, hold a 60 s "hearth flame" window
  // before looping back to figure #1.
  flamePhaseDuration  = 60.0,
  flameFadeIn         = 2.5,
  flameFadeOut        = 2.5,
} = {}) {
  const group = new THREE.Group();
  group.name = 'constellation';

  // ---- Build the 5-figure sequence ------------------------------------
  const sequence = buildSequence(silhouettePolygons);
  if (sequence.length === 0) {
    return {
      group,
      update:        () => {},
      setOpacity:    () => {},
      triggerPulse:  () => {},
      anchorCount:   0,
      edgeCount:     0,
    };
  }

  const fcx = fadeCenter[0], fcy = fadeCenter[1];
  // Pre-process every star + edge in every sequence entry: per-anchor
  // radius/ray from fadeCenter (for the shockwave) and per-edge midpoint
  // radius (so the wavefront brightens lines too). Twinkle phase/speed
  // also fixed at init so each star keeps its identity across cycles.
  for (const entry of sequence) {
    for (const a of entry.stars) {
      const dx = a.x - fcx, dy = a.y - fcy;
      a.r  = Math.hypot(dx, dy);
      a.rx = a.r > 1e-3 ? dx / a.r : 0;
      a.ry = a.r > 1e-3 ? dy / a.r : 1;
      a.basePhase    = Math.random() * Math.PI * 2;
      a.twinkleSpeed = 0.4 + Math.random() * 1.0;
    }
    for (const e of entry.edges) {
      const A = entry.stars[e.a], B = entry.stars[e.b];
      e.ax = A.x; e.ay = A.y;
      e.bx = B.x; e.by = B.y;
      e.r  = (A.r + B.r) * 0.5;
    }
  }

  // Largest figure sizes across the whole sequence — buffers are
  // pre-allocated to this so any cycle's data fits without reallocating.
  let maxStars = 0, maxEdges = 0;
  for (const entry of sequence) {
    if (entry.stars.length > maxStars) maxStars = entry.stars.length;
    if (entry.edges.length > maxEdges) maxEdges = entry.edges.length;
  }

  const baseColor = new THREE.Color(color);

  // ---- Anchor points (custom shader Points) ----------------------------
  // Buffers sized for the largest figure — unused slots each cycle have
  // colour=0 + size=0 so they don't render. drawRange below is set per
  // cycle to the active star count.
  const posBuf  = new Float32Array(maxStars * 3);
  const colBuf  = new Float32Array(maxStars * 3);
  const sizeBuf = new Float32Array(maxStars);
  const ptsGeom = new THREE.BufferGeometry();
  ptsGeom.setAttribute('position', new THREE.BufferAttribute(posBuf,  3));
  ptsGeom.setAttribute('aColor',   new THREE.BufferAttribute(colBuf,  3));
  ptsGeom.setAttribute('aSize',    new THREE.BufferAttribute(sizeBuf, 1));
  ptsGeom.setDrawRange(0, 0);   // nothing drawn until a constellation activates

  const ptsMat = new THREE.ShaderMaterial({
    uniforms: {
      uOpacity: { value: 0 },
      uPixelRatio: { value: window.devicePixelRatio || 1 },
    },
    transparent: true,
    blending:    THREE.AdditiveBlending,
    depthTest:   false,
    depthWrite:  false,
    vertexShader: `
      attribute vec3 aColor;
      attribute float aSize;
      uniform float uPixelRatio;
      varying vec3 vColor;
      void main() {
        vColor = aColor;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        // aSize is already in screen pixels; multiply only by device
        // pixel ratio so the visual size is constant across DPRs and
        // independent of camera distance (small parallax around a near-
        // static camera).
        gl_PointSize = aSize * uPixelRatio;
      }
    `,
    fragmentShader: `
      uniform float uOpacity;
      varying vec3 vColor;
      void main() {
        vec2 uv = gl_PointCoord - 0.5;
        float r = length(uv);
        if (r > 0.5) discard;
        float halo = smoothstep(0.5, 0.0, r);
        float core = pow(smoothstep(0.5, 0.10, r), 3.0);
        float a = halo + core * 1.4;
        gl_FragColor = vec4(vColor * a, uOpacity * a);
      }
    `,
  });
  const points = new THREE.Points(ptsGeom, ptsMat);
  points.renderOrder = 5;
  group.add(points);

  // ---- Edges + line mesh ----------------------------------------------
  // Buffers sized for the largest figure across the sequence. Each cycle
  // only the first `activeEdges.length` segments hold real data; the
  // rest stay zero-length + zero-colour so they don't render.
  const linePos = new Float32Array(maxEdges * 6);    // zero-init = zero-length
  const lineColors = new Float32Array(maxEdges * 6); // zero-init = invisible

  const lineGeom = new LineSegmentsGeometry();
  lineGeom.setPositions(linePos);
  lineGeom.setColors(lineColors);

  const lineMat = new LineMaterial({
    color:        0xFFFFFF,
    linewidth:    baseLinewidth,
    vertexColors: true,
    transparent:  true,
    opacity:      0,
    blending:     THREE.AdditiveBlending,
    depthTest:    false,
    depthWrite:   false,
  });
  const sz = new THREE.Vector2();
  if (renderer) renderer.getSize(sz); else sz.set(window.innerWidth, window.innerHeight);
  lineMat.resolution.set(sz.x, sz.y);

  const lineMesh = new LineSegments2(lineGeom, lineMat);
  lineMesh.renderOrder = 5;
  group.add(lineMesh);

  // Cached refs to the InstancedInterleavedBuffers so per-frame writes
  // hit the underlying Float32Array directly + just flag needsUpdate.
  const positionBuffer = lineGeom.attributes.instanceStart.data;
  const colorBuffer    = lineGeom.attributes.instanceColorStart.data;

  // ---- Cycle state machine --------------------------------------------
  // Phases: IDLE → DRAWING → PULSING → FADING → GAP → DRAWING … looping
  // through the sequence forever. cycleIndex tracks which sequence entry
  // is current; phaseStart is the activeTime when the current phase began.
  const PHASE_IDLE    = 0;
  const PHASE_DRAWING = 1;
  const PHASE_PULSING = 2;
  const PHASE_FADING  = 3;
  const PHASE_GAP     = 4;
  const PHASE_FLAME   = 5;
  let phase       = PHASE_IDLE;
  let phaseStart  = 0;
  let cycleIndex  = -1;            // -1 until the first figure activates
  let activeEntry = null;          // { figure, stars, edges } currently on screen
  let drawQueue   = [];            // edge indices yet to start drawing
  let nextDrawAt  = 0;             // activeTime at which next edge starts
  let pulseActive = false;
  let pulseStartT = 0;
  let pulseFiredThisCycle = false;
  let flamePhaseQueued = false;    // true after last constellation; consumed on enter
  let activeTime  = 0;             // local clock; only advances while visible

  // Activate the next constellation in the sequence: reset edge state,
  // shuffle the draw queue, and write the new positions into the geometry
  // buffers. Called on each DRAWING-phase entry.
  function activateCycle(idx) {
    activeEntry = sequence[idx];
    const E = activeEntry.edges.length;
    const N = activeEntry.stars.length;
    // Reset all edge states + zero-init the position buffer for the
    // first frame (each segment will pop into existence at its A
    // anchor; the draw-in animation then extends end → B).
    for (let i = 0; i < E; i++) {
      const e = activeEntry.edges[i];
      e.state        = 'pending';
      e.progress     = 0;
      e.drawElapsed  = 0;
      e.flareElapsed = 999;
      linePos[i*6+0] = e.ax; linePos[i*6+1] = e.ay; linePos[i*6+2] = 0;
      linePos[i*6+3] = e.ax; linePos[i*6+4] = e.ay; linePos[i*6+5] = 0;
      // Zero colour so unused buffer leftovers from the previous figure
      // don't flash through on the first frame.
      lineColors[i*6+0] = 0; lineColors[i*6+1] = 0; lineColors[i*6+2] = 0;
      lineColors[i*6+3] = 0; lineColors[i*6+4] = 0; lineColors[i*6+5] = 0;
    }
    // Wipe the tail (any edges beyond the active count from a previous
    // larger figure) so they don't render.
    for (let i = E; i < maxEdges; i++) {
      linePos[i*6+0] = 0; linePos[i*6+1] = 0; linePos[i*6+2] = 0;
      linePos[i*6+3] = 0; linePos[i*6+4] = 0; linePos[i*6+5] = 0;
      lineColors[i*6+0] = 0; lineColors[i*6+1] = 0; lineColors[i*6+2] = 0;
      lineColors[i*6+3] = 0; lineColors[i*6+4] = 0; lineColors[i*6+5] = 0;
    }
    // Same for points — write current figure's anchors, zero the tail.
    for (let i = 0; i < N; i++) {
      posBuf[i*3+0] = activeEntry.stars[i].x;
      posBuf[i*3+1] = activeEntry.stars[i].y;
      posBuf[i*3+2] = 0;
      sizeBuf[i]    = pointSize;
    }
    for (let i = N; i < maxStars; i++) {
      posBuf[i*3+0] = 0; posBuf[i*3+1] = 0; posBuf[i*3+2] = 0;
      sizeBuf[i] = 0;
    }
    ptsGeom.setDrawRange(0, N);
    if ('instanceCount' in lineGeom) lineGeom.instanceCount = E;

    positionBuffer.needsUpdate = true;
    colorBuffer.needsUpdate    = true;
    ptsGeom.attributes.position.needsUpdate = true;
    ptsGeom.attributes.aSize.needsUpdate    = true;

    // Random draw order so each figure fills in unpredictably.
    drawQueue = Array.from({ length: E }, (_, i) => i);
    for (let i = drawQueue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [drawQueue[i], drawQueue[j]] = [drawQueue[j], drawQueue[i]];
    }
    nextDrawAt = activeTime;
    pulseFiredThisCycle = false;
    pulseActive = false;
    console.log(`[constellation] cycle ${idx + 1}/${sequence.length}: ${activeEntry.figure.name}`);
  }

  function triggerPulse() {
    pulseActive = true;
    pulseStartT = activeTime;
  }

  // External fade — main.js drives this in/out as flameOnly mode begins
  // and ends. Stored once and applied to materials inside update().
  let groupOpacity = 0;
  function setOpacity(a) { groupOpacity = a; }

  function update(t, dt) {
    if (groupOpacity <= 0.002) {
      lineMat.opacity = groupOpacity;
      ptsMat.uniforms.uOpacity.value = groupOpacity;
      return;
    }
    activeTime += dt;
    const phaseElapsed = activeTime - phaseStart;

    // --- Phase transitions ------------------------------------------------
    if (phase === PHASE_IDLE) {
      if (activeTime >= initialDelay) {
        phase       = PHASE_DRAWING;
        phaseStart  = activeTime;
        cycleIndex  = 0;
        activateCycle(cycleIndex);
      }
    } else if (phase === PHASE_DRAWING) {
      const allDrawn = activeEntry && activeEntry.edges.every(e => e.state === 'drawn');
      if (allDrawn || phaseElapsed >= drawingMaxDuration) {
        phase      = PHASE_PULSING;
        phaseStart = activeTime;
      }
    } else if (phase === PHASE_PULSING) {
      if (!pulseFiredThisCycle && phaseElapsed >= pulseTriggerDelay) {
        triggerPulse();
        pulseFiredThisCycle = true;
      }
      if (phaseElapsed >= pulsingDuration) {
        phase      = PHASE_FADING;
        phaseStart = activeTime;
        // Queue the flame phase right after the LAST figure's fade+gap.
        if (cycleIndex === sequence.length - 1) flamePhaseQueued = true;
      }
    } else if (phase === PHASE_FADING) {
      if (phaseElapsed >= fadingDuration) {
        phase      = PHASE_GAP;
        phaseStart = activeTime;
      }
    } else if (phase === PHASE_GAP) {
      if (phaseElapsed >= gapDuration) {
        // After the LAST constellation in the sequence, the next slot is
        // the hearth-flame window; flamePhaseQueued is set when cycle 5
        // entered FADING. The flame phase then exits back into PHASE_GAP
        // for a second rest before constellation #1 restarts.
        if (flamePhaseQueued) {
          flamePhaseQueued = false;
          phase      = PHASE_FLAME;
          phaseStart = activeTime;
          console.log('[constellation] entering flame phase');
        } else {
          cycleIndex = (cycleIndex + 1) % sequence.length;
          phase      = PHASE_DRAWING;
          phaseStart = activeTime;
          activateCycle(cycleIndex);
        }
      }
    } else if (phase === PHASE_FLAME) {
      if (phaseElapsed >= flamePhaseDuration) {
        phase      = PHASE_GAP;
        phaseStart = activeTime;
        console.log('[constellation] flame phase done; resting before cycle 1');
      }
    }

    // Pulse state machine (independent of phase but only meaningful
    // during PULSING / FADING).
    let shockR = -1, shockEnv = 0;
    if (pulseActive) {
      const u = (activeTime - pulseStartT) / pulseDuration;
      if (u >= 1) {
        pulseActive = false;
      } else {
        shockR   = hullMaxR * (1 - u);
        shockEnv = Math.sin(u * Math.PI);
      }
    }
    const shockOn = shockR >= 0;

    // --- Phase-driven opacity multiplier ---------------------------------
    // The constellation group itself fades in via setOpacity from main.js
    // (group-level). Per-phase we multiply by a fade factor so each
    // constellation fades OUT at the end of its turn, and the gap holds
    // everything invisible briefly before the next one starts drawing.
    let phaseMul = 1;
    if (phase === PHASE_IDLE)      phaseMul = 0;
    else if (phase === PHASE_FADING) phaseMul = Math.max(0, 1 - phaseElapsed / fadingDuration);
    else if (phase === PHASE_GAP)    phaseMul = 0;
    else if (phase === PHASE_FLAME)  phaseMul = 0;
    const visualOpacity = groupOpacity * phaseMul;

    // Early-out for the IDLE/GAP/FLAME phases — nothing to animate on
    // the constellation, just clear the visible state. Skip the per-edge
    // / per-anchor loops entirely.
    if (!activeEntry || phase === PHASE_IDLE || phase === PHASE_GAP || phase === PHASE_FLAME) {
      lineMat.opacity = visualOpacity;
      ptsMat.uniforms.uOpacity.value = visualOpacity;
      return;
    }

    const stars = activeEntry.stars;
    const edges = activeEntry.edges;
    const N = stars.length;
    const E = edges.length;

    // Schedule next draw-in (only during PHASE_DRAWING — once we're in
    // pulsing/fading, every edge is already drawn).
    if (phase === PHASE_DRAWING && drawQueue.length > 0 && activeTime >= nextDrawAt) {
      const idx = drawQueue.shift();
      const e = edges[idx];
      e.state        = 'drawing';
      e.progress     = 0;
      e.drawElapsed  = 0;
      e.flareElapsed = 999;
      nextDrawAt = activeTime + drawIntervalMin
                 + Math.random() * (drawIntervalMax - drawIntervalMin);
    }

    // --- Anchor stars ----------------------------------------------------
    for (let i = 0; i < N; i++) {
      const a = stars[i];
      const tw = pointBaseBright + 0.25 * Math.sin(a.basePhase + activeTime * a.twinkleSpeed);
      let bright    = tw;
      let radialOff = 0;
      let sizeBoost = 0;
      if (shockOn) {
        const passing = Math.max(0, 1 - Math.abs(a.r - shockR) / pulseWavefrontWidth);
        const p       = passing * shockEnv;
        bright    += p * 2.5;
        radialOff -= p * pulseConvergeDist;
        sizeBoost += p * 0.7;
      }
      posBuf[i*3+0] = a.x + a.rx * radialOff;
      posBuf[i*3+1] = a.y + a.ry * radialOff;
      colBuf[i*3+0] = baseColor.r * bright;
      colBuf[i*3+1] = baseColor.g * bright;
      colBuf[i*3+2] = baseColor.b * bright;
      sizeBuf[i]    = pointSize * (1 + sizeBoost);
    }
    ptsGeom.attributes.position.needsUpdate = true;
    ptsGeom.attributes.aColor.needsUpdate   = true;
    ptsGeom.attributes.aSize.needsUpdate    = true;
    ptsMat.uniforms.uOpacity.value = visualOpacity;

    // --- Line segments ---------------------------------------------------
    const lpos = positionBuffer.array;
    const lcol = colorBuffer.array;
    for (let i = 0; i < E; i++) {
      const e   = edges[i];
      const off = i * 6;

      if (e.state === 'drawing') {
        e.drawElapsed += dt;
        e.progress = Math.min(1, e.drawElapsed / drawDuration);
        if (e.progress >= 1) {
          e.state = 'drawn';
          e.flareElapsed = 0;
        }
      } else if (e.state === 'drawn') {
        e.flareElapsed += dt;
      }

      const endX = e.ax + (e.bx - e.ax) * e.progress;
      const endY = e.ay + (e.by - e.ay) * e.progress;
      lpos[off+0] = e.ax; lpos[off+1] = e.ay; lpos[off+2] = 0;
      lpos[off+3] = endX; lpos[off+4] = endY; lpos[off+5] = 0;

      let segBright;
      if (e.state === 'pending') {
        segBright = 0;
      } else if (e.state === 'drawing') {
        segBright = 0.8;
      } else {
        const u = e.flareElapsed / flareDuration;
        if (u < 1) {
          const env = u < 0.4 ? u / 0.4 : Math.max(0, 1 - (u - 0.4) / 0.6);
          segBright = persistentOpacity + env * (flareIntensity - persistentOpacity);
        } else {
          segBright = persistentOpacity;
        }
      }
      if (shockOn) {
        const passing = Math.max(0, 1 - Math.abs(e.r - shockR) / pulseWavefrontWidth);
        segBright += passing * shockEnv * pulseBoostIntensity;
      }

      const r = baseColor.r * segBright;
      const g = baseColor.g * segBright;
      const b = baseColor.b * segBright;
      lcol[off+0] = r; lcol[off+1] = g; lcol[off+2] = b;
      lcol[off+3] = r; lcol[off+4] = g; lcol[off+5] = b;
    }
    positionBuffer.needsUpdate = true;
    colorBuffer.needsUpdate    = true;
    lineMat.opacity = visualOpacity;

    // Keep line resolution in sync (window resize).
    if (renderer) {
      renderer.getSize(sz);
      if (Math.abs(sz.x - lineMat.resolution.x) > 0.5 ||
          Math.abs(sz.y - lineMat.resolution.y) > 0.5) {
        lineMat.resolution.set(sz.x, sz.y);
      }
    }
  }

  // Hearth-flame opacity target — 0 outside the flame phase, ramps in
  // over flameFadeIn at the start of PHASE_FLAME, holds at 1 through the
  // body, ramps out over flameFadeOut before the phase ends. main.js
  // reads this each frame to drive the hearth-flame group's visibility
  // and material opacity.
  function getFlameOpacity() {
    if (phase !== PHASE_FLAME) return 0;
    const e = activeTime - phaseStart;
    if (e < flameFadeIn)                       return e / flameFadeIn;
    if (e > flamePhaseDuration - flameFadeOut) {
      return Math.max(0, (flamePhaseDuration - e) / flameFadeOut);
    }
    return 1;
  }

  console.log(`[constellation] sequence built — ${sequence.length} figures, max ${maxStars} stars / ${maxEdges} edges per buffer`);

  return {
    group,
    update,
    setOpacity,
    triggerPulse,
    getFlameOpacity,
    figureCount: sequence.length,
  };
}
