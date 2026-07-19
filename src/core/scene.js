// Scene, camera, renderer, controls, environment map. The ACES tonemapper
// and the PMREM environment give the metallic logo material something to
// reflect (envTint) while the black scene background stays true black.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COLORS } from '../config.js';
import { QUALITY } from '../quality.js';

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(COLORS.sceneBackground);

  const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 1, 3);

  const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  // Cap pixel ratio so high-DPI screens (3×+) don't render 9× more pixels
  // per frame for no visible benefit. QUALITY.preset.pixelRatioMax can be
  // lowered live by the 'Q' quality cycle to recover headroom on weak GPUs.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, QUALITY.preset.pixelRatioMax));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  document.body.appendChild(renderer.domElement);

  // Environment map — procedural "studio" instead of the old flat grey.
  // A BackSide gradient sphere (dark warm floor → warm horizon → cool
  // zenith) gives the metal directional colour variation, and thin bright
  // softbox strips at grazing angles put long streaked highlights on the
  // gold body — the difference between "flat paint" and "premium metal".
  // Knobs: COLORS.env { floor, horizon, zenith, softboxIntensity }.
  scene.environment = buildStudioEnvironment(renderer);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0);

  // NOTE: no resize listener here — src/core/pipeline.js is the single
  // render/size authority and owns the window resize handling.

  // Double-click recenters the camera on the logo's default framing.
  renderer.domElement.addEventListener('dblclick', () => {
    camera.position.set(0, -1.0, 6);
    controls.target.set(0, -1.0, 0);
    controls.update();
  });

  // Devtools handles for live inspection.
  window.__scene    = scene;
  window.__camera   = camera;
  window.__controls = controls;
  window.__renderer = renderer;
  window.__THREE    = THREE;

  return { scene, camera, renderer, controls };
}

// Procedural studio environment → PMREM texture. Built once at boot;
// every temp object is disposed after baking so only the PMREM cubemap
// survives. The fireplace-mode env strip in main.js nulls
// scene.environment and restores this texture — untouched by design.
function buildStudioEnvironment(renderer) {
  const cfg = COLORS.env || {};
  const floorHex   = cfg.floor   || '#1A120A';
  const horizonHex = cfg.horizon || '#6B4A26';
  const zenithHex  = cfg.zenith  || '#2A2E38';
  const softboxI   = cfg.softboxIntensity ?? 3.0;

  const envScene = new THREE.Scene();

  // 3-stop vertical gradient sphere, evaluated on the view direction so
  // the bands read as floor / horizon / sky regardless of radius.
  const gradientMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uFloor:   { value: new THREE.Color(floorHex) },
      uHorizon: { value: new THREE.Color(horizonHex) },
      uZenith:  { value: new THREE.Color(zenithHex) },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uFloor;
      uniform vec3 uHorizon;
      uniform vec3 uZenith;
      varying vec3 vDir;
      void main() {
        float y = normalize(vDir).y;   // -1 floor .. 0 horizon .. +1 zenith
        vec3 c = (y < 0.0)
          ? mix(uHorizon, uFloor,  smoothstep(0.0, 0.65, -y))
          : mix(uHorizon, uZenith, smoothstep(0.05, 0.75,  y));
        gl_FragColor = vec4(c, 1.0);
      }
    `,
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), gradientMat);
  envScene.add(sphere);

  // Softboxes — thin overbright strips at grazing angles. Long + narrow
  // so specular reflections streak across the metal instead of blobbing.
  // MeshBasicMaterial colour IS radiance inside a PMREM bake; multiplying
  // past 1.0 makes them read as true emitters.
  const softColor = new THREE.Color(cfg.softboxColor || '#FFF2D8');
  const softMat = new THREE.MeshBasicMaterial({
    color: softColor.clone().multiplyScalar(softboxI),
    side: THREE.DoubleSide,
  });
  const strip = new THREE.PlaneGeometry(30, 4);
  const softboxes = [
    { pos: [-28, 18,  20], scale: 1.0 },   // key streak — upper left front
    { pos: [ 30,  6,  14], scale: 0.8 },   // right rake, near horizon
    { pos: [  4, 34, -10], scale: 0.7 },   // cool-ish top pop from behind
  ];
  const softMeshes = softboxes.map(({ pos, scale }) => {
    const m = new THREE.Mesh(strip, softMat);
    m.position.set(...pos);
    m.scale.setScalar(scale);
    m.lookAt(0, 0, 0);
    envScene.add(m);
    return m;
  });

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envTexture = pmremGenerator.fromScene(envScene).texture;

  // Bake done — free every temp resource.
  sphere.geometry.dispose();
  gradientMat.dispose();
  strip.dispose();
  softMat.dispose();
  softMeshes.forEach(m => envScene.remove(m));
  envScene.remove(sphere);
  pmremGenerator.dispose();

  return envTexture;
}

// Framing used both at initial load (after the model is added) and by the
// dblclick handler — one source of truth.
export function frameLogo(camera, controls) {
  camera.position.set(0, -1.0, 6);
  controls.target.set(0, -1.0, 0);
  controls.update();
}
