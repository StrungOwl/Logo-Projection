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
  color = 0xffd9a0,
  pointSize = 0.45,
  trailSize = 5,
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
  const reached = new Uint8Array(count);

  // Trail ring-buffer: trailSize positions per spark. Only the head slot gets
  // a fresh position each frame; older slots keep their stored x/y and just
  // recompute alpha/size so the trail appears to fade back along the path.
  const totalPoints = count * trailSize;
  const positions = new Float32Array(totalPoints * 3);
  const alphas = new Float32Array(totalPoints);
  const sizes = new Float32Array(totalPoints);
  const trailHead = new Int32Array(count);

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
    reached[i] = 0;
    // Seed every trail slot with the spawn position so stale positions from
    // the spark's previous life don't flash as a ghost trail.
    const base = i * trailSize;
    for (let k = 0; k < trailSize; k++) {
      positions[(base + k) * 3 + 0] = px[i];
      positions[(base + k) * 3 + 1] = py[i];
      positions[(base + k) * 3 + 2] = z;
      alphas[base + k] = 0;
      sizes[base + k]  = 0;
    }
    trailHead[i] = 0;
  }

  for (let i = 0; i < count; i++) respawn(i);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uMap:   { value: getSparkSprite() },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
    },
    vertexShader: `
      attribute float aAlpha;
      attribute float aSize;
      varying float vAlpha;
      uniform float uPixelRatio;
      void main() {
        vAlpha = aAlpha;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = aSize * uPixelRatio * (300.0 / -mv.z);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform sampler2D uMap;
      varying float vAlpha;
      void main() {
        vec4 tex = texture2D(uMap, gl_PointCoord);
        if (tex.a < 0.01) discard;
        gl_FragColor = vec4(uColor, tex.a * vAlpha);
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

  function update(dt) {
    // Frame-rate-independent damping: vel *= exp(-damping * dt)
    const dampFactor = Math.exp(-damping * dt);
    // Position-blend snap rate. snapStrength is in "1/s" — over one second a
    // spark moves ~(1 - e^(-snapStrength)) of the way to the nearest vertex.
    const snapBlend = 1 - Math.exp(-snapStrength * dt);

    for (let i = 0; i < count; i++) {
      const x = px[i], y = py[i];
      const dx = fcx - x, dy = fcy - y;
      const distCentre = Math.hypot(dx, dy) + 1e-5;

      // Gravity: constant-magnitude pull toward fadeCenter. Near the centre
      // we taper it so sparks don't overshoot and ping-pong.
      const centreTaper = Math.min(1, distCentre / Math.max(innerFadeStart, 1));
      const gx = (dx / distCentre) * gravity * centreTaper;
      const gy = (dy / distCentre) * gravity * centreTaper;

      // Integrate velocity under gravity + damping (no snap in the velocity —
      // snap is applied as a POSITION blend below so it can't create
      // spring-mass oscillations).
      vx[i] = vx[i] * dampFactor + gx * dt;
      vy[i] = vy[i] * dampFactor + gy * dt;

      // Cap speed so nothing flies off the map after a long fall.
      const sp = Math.hypot(vx[i], vy[i]);
      if (sp > maxSpeed) {
        const k = maxSpeed / sp;
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
      let nearestId = findNearestVertex(cloud, nx, ny, 3, distCentre);
      if (nearestId < 0) nearestId = findNearestVertex(cloud, nx, ny, 3);
      if (nearestId >= 0) {
        const tx = cloud.xs[nearestId], ty = cloud.ys[nearestId];
        nx = nx + (tx - nx) * snapBlend;
        ny = ny + (ty - ny) * snapBlend;
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
        alphas[slot] = intensity * trail * trail;
        sizes[slot]  = pointSize * (0.55 + 0.45 * trail);
      }
    }

    geometry.attributes.position.needsUpdate = true;
    geometry.attributes.aAlpha.needsUpdate = true;
    geometry.attributes.aSize.needsUpdate = true;
  }

  return { points, update };
}
