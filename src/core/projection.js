// Projection mode — fixed-resolution, locked head-on framing for feeding
// TouchDesigner (or the built-in corner-pin warp). The camera is a locked
// low-FOV perspective, NOT orthographic: every point-sprite shader sizes
// via 1/-mvPosition.z (constant under ortho → particles break), and the
// depth-parallax layers are part of the look. At fov 20 the silhouette-to-
// frame mapping is stable enough for mapping software to treat as flat.
//
// Enable via URL (?proj=1&w=1920&h=1080&fov=20&zoom=1) or Shift+P.
// Framing fits the LOGO silhouette (logoMesh geometry bbox in world
// space), not the whole scene graph — outer effect bricks may extend past
// the frame edge by design; the physical surface is the logo.

import * as THREE from 'three';
import { ANIM } from '../config.js';
import { frameLogo } from './scene.js';

export function createProjectionMode({ camera, controls, pipeline }) {
  const params = new URLSearchParams(window.location.search);
  const bootRequested = params.get('proj') === '1' || params.has('projection');
  const bootW = parseInt(params.get('w') || '1920', 10) || 1920;
  const bootH = parseInt(params.get('h') || '1080', 10) || 1080;
  if (params.has('fov'))  ANIM.projection.fov  = parseFloat(params.get('fov'))  || ANIM.projection.fov;
  if (params.has('zoom')) ANIM.projection.zoom = parseFloat(params.get('zoom')) || ANIM.projection.zoom;

  let active = false;
  let worldBox = null;      // logo silhouette bounds in world space, cached
  let saved = null;         // camera state to restore on disable

  // Called once after the logo loads (and after scene.updateMatrixWorld).
  function setLogo(logoMesh) {
    logoMesh.geometry.computeBoundingBox();
    worldBox = logoMesh.geometry.boundingBox.clone()
      .applyMatrix4(logoMesh.matrixWorld);
    if (active) frame();
  }

  // Position the camera on the +Z axis so the logo front face fills the
  // frame: distance chosen from whichever axis is binding at the current
  // aspect, measured from the FRONT plane (box.max.z) so the silhouette
  // fits exactly and deeper geometry projects inside the margin.
  function frame() {
    if (!worldBox) return;
    const cfg = ANIM.projection;
    const center = worldBox.getCenter(new THREE.Vector3());
    const size   = worldBox.getSize(new THREE.Vector3());
    const grow   = (1 + (cfg.margin ?? 0.06)) / (cfg.zoom || 1);
    const halfW  = (size.x / 2) * grow;
    const halfH  = (size.y / 2) * grow;
    const tanH   = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const d      = Math.max(halfH / tanH, halfW / (tanH * camera.aspect));
    const cx = center.x + (cfg.offsetX || 0);
    const cy = center.y + (cfg.offsetY || 0);
    camera.position.set(cx, cy, worldBox.max.z + d);
    controls.target.set(cx, cy, center.z);
    camera.lookAt(cx, cy, center.z);
    camera.updateProjectionMatrix();
  }

  function enable(opts = {}) {
    if (active) return;
    saved = {
      fov: camera.fov,
      pos: camera.position.clone(),
      target: controls.target.clone(),
    };
    pipeline.enterProjection(opts.width || bootW, opts.height || bootH);
    camera.fov = ANIM.projection.fov;
    frame();
    controls.enabled = false;
    // Read by quality.js's toast so no DOM chrome pollutes the feed.
    window.__SUPPRESS_TOASTS = true;
    active = true;
  }

  function disable() {
    if (!active) return;
    active = false;
    window.__SUPPRESS_TOASTS = false;
    pipeline.exitProjection();
    camera.fov = saved.fov;
    camera.position.copy(saved.pos);
    controls.target.copy(saved.target);
    camera.updateProjectionMatrix();
    controls.enabled = true;
    frameLogo(camera, controls);
  }

  return {
    bootRequested, bootW, bootH,
    setLogo, frame, enable, disable,
    toggle(opts) { active ? disable() : enable(opts); },
    isActive: () => active,
  };
}
