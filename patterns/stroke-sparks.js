import * as THREE from 'three';

// Collect every stroke-vertex position in the group's LOCAL frame and index
// them in a coarse spatial hash for fast nearest-vertex lookup. No adjacency
// is stored — sparks fly freely under gravity and simply snap to whatever
// stroke point is closest, so topology isn't needed.
//
// The group should be unparented or have a valid matrixWorld chain at call
// time; either way we transform via groupInv * obj.matrixWorld to get panel-
// local coords.
export function buildStrokeCloud(patternGroup, fadeCenter) {
  patternGroup.updateMatrixWorld(true);

  const dedupeBucket = 0.04;
  const dedupeEps2 = 0.0004;
  const dedupe = new Map();
  const xs = [];          // vertex x
  const ys = [];          // vertex y
  const rs = [];          // distance to fadeCenter (flow-sense)

  function dkey(ix, iy) { return ix * 73856093 ^ iy * 19349663; }
  function addUnique(x, y) {
    const ix = Math.round(x / dedupeBucket);
    const iy = Math.round(y / dedupeBucket);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const k = dkey(ix + dx, iy + dy);
        const ids = dedupe.get(k);
        if (!ids) continue;
        for (const id of ids) {
          const ddx = xs[id] - x, ddy = ys[id] - y;
          if (ddx * ddx + ddy * ddy < dedupeEps2) return;
        }
      }
    }
    const id = xs.length;
    xs.push(x); ys.push(y);
    const rx = x - fadeCenter[0], ry = y - fadeCenter[1];
    rs.push(Math.hypot(rx, ry));
    const k = dkey(ix, iy);
    if (!dedupe.has(k)) dedupe.set(k, []);
    dedupe.get(k).push(id);
  }

  const tmp = new THREE.Vector3();
  const groupInv = new THREE.Matrix4().copy(patternGroup.matrixWorld).invert();
  const toPanel = new THREE.Matrix4();
  patternGroup.traverse(obj => {
    if (!obj.isLineSegments || !obj.geometry) return;
    const pos = obj.geometry.attributes.position;
    toPanel.multiplyMatrices(groupInv, obj.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(toPanel);
      addUnique(tmp.x, tmp.y);
    }
  });

  // Bounds + pattern centre (for seed spawn — distance-from-bbox-centre, so
  // seeds wrap evenly around the visible outer edge regardless of how
  // fadeCenter is offset inside the pattern).
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < xs.length; i++) {
    if (xs[i] < minX) minX = xs[i]; if (xs[i] > maxX) maxX = xs[i];
    if (ys[i] < minY) minY = ys[i]; if (ys[i] > maxY) maxY = ys[i];
  }
  const bboxCx = (minX + maxX) * 0.5;
  const bboxCy = (minY + maxY) * 0.5;
  let maxR = 0, maxRPanel = 0;
  const rsPanel = new Float32Array(xs.length);
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i] - bboxCx, dy = ys[i] - bboxCy;
    rsPanel[i] = Math.hypot(dx, dy);
    if (rs[i] > maxR) maxR = rs[i];
    if (rsPanel[i] > maxRPanel) maxRPanel = rsPanel[i];
  }

  // Outer seed pool — top 40 % of rPanel distribution.
  const outerThresh = maxRPanel * 0.6;
  const outerSeedIds = [];
  for (let i = 0; i < xs.length; i++) {
    if (rsPanel[i] >= outerThresh) outerSeedIds.push(i);
  }

  // Query grid for nearest-vertex lookup. Grid cell size is chosen so typical
  // neighbour-search queries touch ~9 cells with a handful of candidates each.
  const queryCell = Math.max(2, maxRPanel * 0.05);   // ~5 % of pattern radius
  const grid = new Map();
  function gkey(ix, iy) { return ix * 73856093 ^ iy * 19349663; }
  for (let i = 0; i < xs.length; i++) {
    const ix = Math.floor(xs[i] / queryCell);
    const iy = Math.floor(ys[i] / queryCell);
    const k = gkey(ix, iy);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }

  return {
    xs: new Float32Array(xs),
    ys: new Float32Array(ys),
    rs: new Float32Array(rs),
    rsPanel,
    outerSeedIds,
    maxR,
    maxRPanel,
    bboxCenter: [bboxCx, bboxCy],
    queryCell,
    grid,
    gkey,
  };
}

// Nearest-vertex query against the spatial grid. Searches the spark's own
// cell plus neighbours up to `maxCells` away — good enough for our density
// of stroke vertices (hundreds to low thousands per pattern).
//
// If `maxR` is finite, only vertices whose `rs` (distance to fadeCenter) is
// strictly less than `maxR` qualify — this lets callers enforce "only snap to
// a vertex that's CLOSER TO CENTRE than I am," which stops gravity and snap
// from cancelling each other out when the geometrically-nearest vertex
// happens to sit behind the spark relative to its flow direction.
function findNearestVertex(cloud, x, y, maxCells = 3, maxR = Infinity) {
  const { xs, ys, rs, queryCell, grid, gkey } = cloud;
  const cx = Math.floor(x / queryCell);
  const cy = Math.floor(y / queryCell);
  let bestI = -1, bestD2 = Infinity;
  for (let dx = -maxCells; dx <= maxCells; dx++) {
    for (let dy = -maxCells; dy <= maxCells; dy++) {
      const ids = grid.get(gkey(cx + dx, cy + dy));
      if (!ids) continue;
      for (const id of ids) {
        if (rs[id] >= maxR) continue;
        const ddx = xs[id] - x, ddy = ys[id] - y;
        const d2 = ddx * ddx + ddy * ddy;
        if (d2 < bestD2) { bestD2 = d2; bestI = id; }
      }
    }
  }
  return bestI;
}

function makeSparkSprite() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x - size / 2) / (size / 2);
      const dy = (y - size / 2) / (size / 2);
      const d = Math.sqrt(dx * dx + dy * dy);
      const a = Math.max(0, 1 - d);
      const v = a * a * a;
      const i = (y * size + x) * 4;
      img.data[i + 0] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(255 * v);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

let _sharedSprite = null;
function getSparkSprite() {
  if (!_sharedSprite) _sharedSprite = makeSparkSprite();
  return _sharedSprite;
}

// Gravitational spark flow: sparks fly freely in 2D under a constant-magnitude
// pull toward `fadeCenter`, while being pulled toward their nearest stroke
// vertex each frame. This lets them "skip" from one stroke to the next as
// they drift inward — whatever stroke point is closest becomes their next
// way-station, no edge-topology needed.
//
// Returns { points, update(dt) } — add `points` as a child of the pattern
// group and call update() each animation frame.
export function createSparkSystem({
  patternGroup,
  fadeCenter,
  fadeOuter,
  count = 35,
  gravity = 14,              // panel-units/s² of pull toward fadeCenter
  maxSpeed = 9,              // panel-units/s — keeps sparks from flinging past centre
  damping = 1.4,             // velocity damping per second (higher = slower drift)
  snapStrength = 6,          // strength of the pull toward the nearest stroke vertex
  tangentialFactor = 0,      // perpendicular-to-radial force as fraction of gravity;
                             // creates a per-spark swirl so sparks fan along outer
                             // strokes instead of diving straight to centre
  speedVariance = 0,         // ±fraction per-spark scale on gravity + maxSpeed
                             // (0.4 → each spark cruises at 0.6x..1.4x base)
  sizeVariance = 0,          // ±fraction around base pointSize (0.7 → ~0.3x..1.7x)
  color = 0xffd9a0,
  hueVariance = 0,           // ±fraction of hue wheel per spark (0.1 ≈ ±36°)
  pointSize = 0.45,
  trailSize = 5,
  startDelay = 0,            // min per-spark wake delay (seconds)
  startDelayMax = null,      // max per-spark wake delay; null → all wake at startDelay
  brightness = 1,            // scales final spark alpha (1 = same as base)
  z = 0.12,
}) {
  const cloud = buildStrokeCloud(patternGroup, fadeCenter);
  if (cloud.xs.length === 0 || cloud.outerSeedIds.length === 0) {
    return { points: new THREE.Group(), update: () => {} };
  }

  const fcx = fadeCenter[0], fcy = fadeCenter[1];

  // Per-spark state.
  const px = new Float32Array(count);
  const py = new Float32Array(count);
  const vx = new Float32Array(count);
  const vy = new Float32Array(count);
  const life = new Float32Array(count);
  const lifeSpeed = new Float32Array(count);
  const sizeScale = new Float32Array(count);
  // Per-spark speed scale — multiplies both gravity and maxSpeed so each
  // spark accelerates AND tops out at a coherent fraction of the base. A
  // 0.6x spark is slow start-to-finish; a 1.4x spark is fast throughout.
  const speedScale = new Float32Array(count);
  const reached = new Uint8Array(count);
  // prevNearest: id of the vertex this spark was snapping to last frame.
  // When it changes, the spark has crossed a "junction" — we redirect its
  // velocity along the bearing to the new vertex for a circuit-board-style
  // hard turn instead of letting momentum smear it across the gap.
  const prevNearest = new Int32Array(count);
  // swirl: ±1 per spark — sign of the tangential (perpendicular-to-radial)
  // force. Picked once at spawn so each spark consistently spirals one way.
  const swirl = new Int8Array(count);

  // Trail ring-buffer: trailSize positions per spark. Only the head slot gets
  // a fresh position each frame; older slots keep their stored x/y and just
  // recompute alpha/size so the trail appears to fade back along the path.
  const totalPoints = count * trailSize;
  const positions = new Float32Array(totalPoints * 3);
  const alphas = new Float32Array(totalPoints);
  const sizes = new Float32Array(totalPoints);
  const colors = new Float32Array(totalPoints * 3);
  const trailHead = new Int32Array(count);

  const baseColor = new THREE.Color(color);
  const baseHsl = { h: 0, s: 0, l: 0 };
  baseColor.getHSL(baseHsl);
  const _scratchColor = new THREE.Color();

  function pickSeed() {
    return cloud.outerSeedIds[(Math.random() * cloud.outerSeedIds.length) | 0];
  }

  function respawn(i) {
    const s = pickSeed();
    px[i] = cloud.xs[s];
    py[i] = cloud.ys[s];
    // Small random initial velocity so freshly-spawned sparks don't all
    // accelerate identically from their seed.
    const a = Math.random() * Math.PI * 2;
    const v0 = 0.5 + Math.random() * 1.5;
    vx[i] = Math.cos(a) * v0;
    vy[i] = Math.sin(a) * v0;
    life[i] = 0;
    lifeSpeed[i] = 0.35 + Math.random() * 0.35;   // ~1.8-3 s fade-in
    sizeScale[i] = Math.max(0.15, 1 + (Math.random() * 2 - 1) * sizeVariance);
    speedScale[i] = Math.max(0.15, 1 + (Math.random() * 2 - 1) * speedVariance);
    reached[i] = 0;
    prevNearest[i] = -1;
    swirl[i] = Math.random() < 0.5 ? -1 : 1;
    // Pick a per-spark colour — base hue shifted by ±hueVariance.
    if (hueVariance > 0) {
      const h = (baseHsl.h + (Math.random() * 2 - 1) * hueVariance + 1) % 1;
      _scratchColor.setHSL(h, baseHsl.s, baseHsl.l);
    } else {
      _scratchColor.copy(baseColor);
    }
    // Seed every trail slot with the spawn position so stale positions from
    // the spark's previous life don't flash as a ghost trail.
    const base = i * trailSize;
    for (let k = 0; k < trailSize; k++) {
      positions[(base + k) * 3 + 0] = px[i];
      positions[(base + k) * 3 + 1] = py[i];
      positions[(base + k) * 3 + 2] = z;
      alphas[base + k] = 0;
      sizes[base + k]  = 0;
      colors[(base + k) * 3 + 0] = _scratchColor.r;
      colors[(base + k) * 3 + 1] = _scratchColor.g;
      colors[(base + k) * 3 + 2] = _scratchColor.b;
    }
    trailHead[i] = 0;
  }

  // Per-spark wake time: sparks stay at their seed position (invisible —
   // respawn() leaves alpha/size at 0) until elapsed >= wakeAt[i], then
   // their physics begins. Lets the system fade in as a staggered stream
   // instead of a synchronized burst.
  const wakeSpread = Math.max(0, (startDelayMax ?? startDelay) - startDelay);
  const wakeAt = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    respawn(i);
    wakeAt[i] = startDelay + Math.random() * wakeSpread;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uMap:        { value: getSparkSprite() },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      // Group-level opacity multiplier — driven from main.js to fade the
      // whole spark cloud out while the playAll overlay window is open
      // (and back in when it closes).
      uOpacity:    { value: 1.0 },
    },
    vertexShader: `
      attribute float aAlpha;
      attribute float aSize;
      attribute vec3 aColor;
      varying float vAlpha;
      varying vec3 vColor;
      uniform float uPixelRatio;
      void main() {
        vAlpha = aAlpha;
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio * (300.0 / -mv.z);
      }
    `,
    fragmentShader: `
      uniform sampler2D uMap;
      uniform float uOpacity;
      varying float vAlpha;
      varying vec3 vColor;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        if (tex.a < 0.01) discard;
        gl_FragColor = vec4(vColor, tex.a * vAlpha * uOpacity);
      }
    `,
  });

  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 5;

  // Wider fade-out band so sparks can retire even if the densest stroke
  // vertex to fadeCenter is a few units out — tight bands make them orbit
  // forever at the innermost vertex without ever reaching retirement.
  const innerFadeStart = fadeOuter * 0.45;
  const innerFadeEnd   = fadeOuter * 0.20;

  const api = { points, update: null, snapScale: 1, uOpacity: material.uniforms.uOpacity };

  let elapsed = 0;
  function update(dt) {
    elapsed += dt;

    // Frame-rate-independent damping: vel *= exp(-damping * dt)
    const dampFactor = Math.exp(-damping * dt);
    // Position-blend snap rate. snapStrength is in "1/s" — over one second a
    // spark moves ~(1 - e^(-snapStrength)) of the way to the nearest vertex.
    // `snapScale` is a runtime multiplier (see api.snapScale) so callers can
    // temporarily release sparks from stroke-snapping (used during the row
    // cascade so sparks drift freely instead of snapping to a moving row's
    // original, now-stale vertex positions).
    const snapBlend = 1 - Math.exp(-snapStrength * api.snapScale * dt);

    for (let i = 0; i < count; i++) {
      // Per-spark wake gate. respawn() left this spark at its seed with
      // alpha=size=0 in every trail slot, so skipping the body keeps it
      // invisible until its turn.
      if (elapsed < wakeAt[i]) continue;
      const x = px[i], y = py[i];
      const dx = fcx - x, dy = fcy - y;
      const distCentre = Math.hypot(dx, dy) + 1e-5;

      // Gravity: constant-magnitude pull toward fadeCenter. Near the centre
      // we taper it so sparks don't overshoot and ping-pong.
      const centreTaper = Math.min(1, distCentre / Math.max(innerFadeStart, 1));
      const radialX = dx / distCentre, radialY = dy / distCentre;
      const grav = gravity * speedScale[i];
      const gx = radialX * grav * centreTaper;
      const gy = radialY * grav * centreTaper;
      // Tangential swirl: rotate the radial 90° (sign per spark) and scale by
      // tangentialFactor. Lets sparks travel sideways along outer strokes
      // before being pulled in — combined with the line-snap, the result
      // reads as flowing through traces on a circuit board.
      const tFx = -radialY * grav * tangentialFactor * swirl[i];
      const tFy =  radialX * grav * tangentialFactor * swirl[i];

      // Integrate velocity under gravity + damping (no snap in the velocity —
      // snap is applied as a POSITION blend below so it can't create
      // spring-mass oscillations).
      vx[i] = vx[i] * dampFactor + (gx + tFx) * dt;
      vy[i] = vy[i] * dampFactor + (gy + tFy) * dt;

      // Cap speed so nothing flies off the map after a long fall.
      const sCap = maxSpeed * speedScale[i];
      const sp = Math.hypot(vx[i], vy[i]);
      if (sp > sCap) {
        const k = sCap / sp;
        vx[i] *= k; vy[i] *= k;
      }

      // Move.
      let nx = x + vx[i] * dt;
      let ny = y + vy[i] * dt;

      // Snap: blend position toward the nearest stroke vertex that is
      // STRICTLY CLOSER TO CENTRE than the spark's current position. This is
      // the key to the traversal — it guarantees every snap step is inward
      // progress, which is how the spark skips from one stroke to the next
      // on its way to the middle. The gravity pull provides the drift that
      // moves the spark into the catchment area of the next inward vertex.
      //
      // Fall back to absolute-nearest only when no inward candidate exists
      // within the search radius (i.e. the spark is deep enough that it
      // should just settle and retire).
      // Stroke snap + junction redirect — skipped entirely when snapStrength
      // is 0 so the system runs as a pure gravity field (used by the central
      // companion layer, which streams straight to centre with no awareness
      // of the pattern strokes).
      if (snapStrength > 0) {
        let nearestId = findNearestVertex(cloud, nx, ny, 3, distCentre);
        if (nearestId < 0) nearestId = findNearestVertex(cloud, nx, ny, 3);
        if (nearestId >= 0) {
          const tx = cloud.xs[nearestId], ty = cloud.ys[nearestId];
          nx = nx + (tx - nx) * snapBlend;
          ny = ny + (ty - ny) * snapBlend;
          // Junction crossing — the spark's nearest vertex just changed, so
          // it has effectively hopped onto a new trace. Redirect velocity
          // along the bearing to the new vertex (preserving speed) so the
          // spark turns sharply toward it instead of curving smoothly.
          if (prevNearest[i] !== -1 && nearestId !== prevNearest[i]) {
            const bdx = tx - nx, bdy = ty - ny;
            const blen = Math.hypot(bdx, bdy);
            if (blen > 1e-4) {
              const speed = Math.hypot(vx[i], vy[i]);
              vx[i] = (bdx / blen) * speed;
              vy[i] = (bdy / blen) * speed;
            }
          }
          prevNearest[i] = nearestId;
        }
      }

      px[i] = nx;
      py[i] = ny;

      // Life / intensity
      life[i] = Math.min(1, life[i] + dt * lifeSpeed[i]);
      const fadeOut = THREE.MathUtils.smoothstep(distCentre, innerFadeEnd, innerFadeStart);
      const intensity = life[i] * fadeOut;

      // Mark reached so the respawn condition below only triggers post-journey.
      if (!reached[i] && distCentre < innerFadeEnd) reached[i] = 1;
      if (reached[i] && intensity < 0.02 && Math.random() < dt * 0.8) {
        respawn(i);
        continue;
      }

      // Advance trail head; write the fresh position to it.
      trailHead[i] = (trailHead[i] + 1) % trailSize;
      const baseIdx = i * trailSize;
      const headSlot = baseIdx + trailHead[i];
      positions[headSlot * 3 + 0] = px[i];
      positions[headSlot * 3 + 1] = py[i];
      positions[headSlot * 3 + 2] = z;

      // Recompute alpha/size for all slots so older positions fade.
      for (let k = 0; k < trailSize; k++) {
        const slot = baseIdx + k;
        const age = ((trailHead[i] - k + trailSize) % trailSize) / trailSize;
        const trail = 1 - age;
        alphas[slot] = intensity * trail * trail * brightness;
        sizes[slot]  = pointSize * sizeScale[i] * (0.55 + 0.45 * trail);
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
  }

  api.update = update;
  return api;
}
