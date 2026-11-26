// Shape mask — keeps the light inside the exact outline of an SVG shape.
//
// The looks draw on a SIMPLIFIED outline (src/core/shape.js), and some of
// them throw light past the edge (sparks, bloom, the backdrop). This pass
// multiplies the finished picture by a mask made from the EXACT outline,
// so the projector lights the object and nothing else.
//
//   mask 'outline'  white inside the outline
//   mask 'holes'    same, minus the small holes of the SVG (openwork)
//   mask 'off'      pass disabled
//
// The mask is drawn with the live camera each frame (one small draw
// call), so it follows the orbit view, projection mode and exports. It
// sits after OutputPass / the morph pass and before the corner-pin warp.
// It needs the composer path (ANIM.post.enabled); the legacy direct
// render has no mask.
//
// Runtime: window.__shapeMask.setMode('holes' | 'outline' | 'off').

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const VERT = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */`
  uniform sampler2D tDiffuse;
  uniform sampler2D tMask;
  uniform vec2  uTexel;      // 1 / mask size
  uniform float uFeather;    // soft edge radius, mask pixels
  varying vec2 vUv;
  void main() {
    float m = texture2D(tMask, vUv).r;
    if (uFeather > 0.0) {
      // 12 taps on two rings: a cheap, even soft edge.
      float acc = m;
      for (int i = 0; i < 12; i++) {
        float a = float(i) * 0.5235988;
        float r = (i - (i / 2) * 2 == 0) ? 1.0 : 0.5;
        acc += texture2D(tMask, vUv + vec2(cos(a), sin(a)) * uTexel * uFeather * r).r;
      }
      m = acc / 13.0;
      // The blurred mask is 0.5 on the edge. Remap so the light is 0 on
      // the edge and full one feather-radius inside: the soft edge never
      // adds light outside the outline.
      m = clamp(m * 2.0 - 1.0, 0.0, 1.0);
    }
    vec4 c = texture2D(tDiffuse, vUv);
    gl_FragColor = vec4(c.rgb * m, c.a);
  }
`;

class ShapeMaskPass extends Pass {
  constructor(owner) {
    super();
    this.owner = owner;
    this.enabled = false;
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null }, tMask: { value: null },
        uTexel: { value: new THREE.Vector2(1, 1) }, uFeather: { value: 0 },
      },
      vertexShader: VERT, fragmentShader: FRAG,
      depthTest: false, depthWrite: false, toneMapped: false,
    });
    this.fsq = new FullScreenQuad(this.mat);
  }

  render(renderer, writeBuffer, readBuffer) {
    const rt = this.owner.drawMask(renderer, readBuffer.width, readBuffer.height);
    const u = this.mat.uniforms;
    u.tDiffuse.value = readBuffer.texture;
    u.tMask.value = rt.texture;
    u.uTexel.value.set(1 / rt.width, 1 / rt.height);
    u.uFeather.value = this.owner.feather;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.fsq.render(renderer);
  }

  dispose() { this.mat.dispose(); this.fsq.dispose(); }
}

function loopsToShape(outer, holes) {
  const shape = new THREE.Shape(outer.map(p => new THREE.Vector2(p.x, p.y)));
  for (const h of holes) {
    shape.holes.push(new THREE.Path(h.slice().reverse().map(p => new THREE.Vector2(p.x, p.y))));
  }
  return shape;
}

export function createShapeMask({ camera }) {
  let maskRT = null;
  let maskScene = null, holder = null, logoMeshRef = null;
  let meshOutline = null, meshHoles = null;
  let mode = 'off';            // 'outline' | 'holes' | 'off'
  let suspended = false;
  const tmpColor = new THREE.Color();
  const tmpVec = new THREE.Vector3();
  let box = null, boxZ = 0;    // box of the outline, mesh units

  const owner = {
    feather: 0,
    drawMask(renderer, w, h) {
      if (!maskRT || maskRT.width !== w || maskRT.height !== h) {
        maskRT?.dispose();
        maskRT = new THREE.WebGLRenderTarget(w, h, { depthBuffer: false, samples: 4 });
      }
      holder.matrix.copy(logoMeshRef.matrixWorld);
      meshOutline.visible = mode === 'outline';
      meshHoles.visible   = mode === 'holes';
      const prevAuto = renderer.autoClear;
      const prevAlpha = renderer.getClearAlpha();
      renderer.getClearColor(tmpColor);
      renderer.autoClear = true;
      renderer.setClearColor(0x000000, 1);
      renderer.setRenderTarget(maskRT);
      renderer.render(maskScene, camera);
      renderer.setClearColor(tmpColor, prevAlpha);
      renderer.autoClear = prevAuto;
      return maskRT;
    },
  };
  const pass = new ShapeMaskPass(owner);
  const sync = () => { pass.enabled = !!maskScene && mode !== 'off' && !suspended; };

  return {
    pass,
    // Called once the shape model is loaded (meta.shape from logo.js).
    attach(logoMesh, meta) {
      const data = meta.shape;
      if (!data) return;
      logoMeshRef = logoMesh;
      const white = new THREE.MeshBasicMaterial({
        color: 0xffffff, toneMapped: false, depthTest: false, side: THREE.DoubleSide,
      });
      // A real cut opening (hole 'svg') stays dark in both modes, so no
      // look spills light into it. maskOpening: false turns this off.
      const opening = (data.exactOpening && data.opts.maskOpening !== false) ? [data.exactOpening] : [];
      meshOutline = new THREE.Mesh(new THREE.ShapeGeometry(loopsToShape(data.exactOuter, opening)), white);
      meshHoles   = new THREE.Mesh(new THREE.ShapeGeometry(loopsToShape(data.exactOuter, [...opening, ...data.exactHoles])), white);
      meshOutline.position.z = meshHoles.position.z = meta.maxZ;
      box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
      for (const p of data.exactOuter) {
        box.minX = Math.min(box.minX, p.x); box.maxX = Math.max(box.maxX, p.x);
        box.minY = Math.min(box.minY, p.y); box.maxY = Math.max(box.maxY, p.y);
      }
      boxZ = meta.maxZ;
      holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.add(meshOutline, meshHoles);
      maskScene = new THREE.Scene();
      maskScene.add(holder);
      mode = ['outline', 'holes', 'off'].includes(data.opts.mask) ? data.opts.mask : 'outline';
      owner.feather = data.opts.maskFeather || 0;
      sync();
    },
    // Calibration mode turns the mask off for a moment (full-frame grids).
    setSuspended(on) { if (suspended !== !!on) { suspended = !!on; sync(); } },
    setMode(m) { mode = m; sync(); return mode; },
    getMode: () => mode,
    setFeather(px) { owner.feather = Math.max(0, px || 0); },
    ready: () => !!maskScene,
    // Where the shape is in the picture: three corners of its box (top
    // left, top right, bottom left). Each is [x, y] from 0 to 1, y down.
    // The layer director (layers.html) puts the wood layers there.
    frame() {
      if (!logoMeshRef || !box) return null;
      logoMeshRef.updateWorldMatrix(true, false);
      camera.updateMatrixWorld();
      return [[box.minX, box.maxY], [box.maxX, box.maxY], [box.minX, box.minY]].map(([x, y]) => {
        const v = tmpVec.set(x, y, boxZ).applyMatrix4(logoMeshRef.matrixWorld).project(camera);
        return [v.x * 0.5 + 0.5, 0.5 - v.y * 0.5];
      });
    },
  };
}
