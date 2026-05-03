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

  // Environment map — neutral grey studio so the metallic logo has something
  // to reflect. Tint via COLORS.envTint.
  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(COLORS.envTint);
  scene.environment = pmremGenerator.fromScene(envScene).texture;

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.05;
  controls.target.set(0, 0, 0);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

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

// Framing used both at initial load (after the model is added) and by the
// dblclick handler — one source of truth.
export function frameLogo(camera, controls) {
  camera.position.set(0, -1.0, 6);
  controls.target.set(0, -1.0, 0);
  controls.update();
}
