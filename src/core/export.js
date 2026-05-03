// =======================================================================
// HOW TO RECORD A VIDEO
// -----------------------------------------------------------------------
// 1. Start a static server in the project root, e.g.:
//      python -m http.server 8000
// 2. Open http://localhost:8000 in Chrome or Edge (Firefox/Safari lack the
//    File System Access + WebCodecs APIs this uses).
// 3. Wait for the scene to finish loading — you should see the logo,
//    particles, and pattern tiles rendering smoothly.
// 4. Press a keyboard shortcut to start a capture:
//      Shift+E  →  4K      (3840×2160)
//      Shift+D  →  1080p   (1920×1080)
//    Or from devtools:  startExport()                    (4K, 1 cycle)
//                       startExport1080p()               (1080p, 1 cycle)
//                       startExport({ width, height, cycles })  (custom)
// 5. A directory picker appears — pick any folder (project root, Desktop,
//    etc.). A `HighResOutput/` folder is created there if it doesn't
//    already exist.
// 6. The live canvas becomes the capture surface (resized to the export
//    resolution, then downscaled by the browser to fill the window) and a
//    progress overlay shows frame count + ETA. Expect roughly 6–12 minutes
//    for 4K, 2–4 minutes for 1080p, depending on disk speed.
// 7. When it finishes, the picked folder contains:
//        HighResOutput/
//        ├── PNGsequence_<W>x<H>/
//        │   ├── frame_00000.png
//        │   └── … one full cascade cycle worth of frames @ 60 fps
//        └── logo_loop_<W>x<H>.mp4
//    Run the shortcut again (same folder → overwrite, different folder →
//    keep both) to record another pass.
//
// Troubleshooting:
// • "Export requires Chrome or Edge" alert → switch browsers.
// • MP4 missing but PNGs present → WebCodecs failed. Use the ffmpeg
//   command printed to the devtools console as a fallback.
// • Shift+E does nothing → the scene hasn't loaded yet, give it a second.
// =======================================================================
//
// Deterministic offline export. Pauses the live loop, resizes the existing
// WebGL canvas to the export resolution, renders the scene into it each
// frame (same pipeline as the live view — ACES tone mapping, output color
// space, custom ShaderMaterial output), reads pixels back synchronously via
// gl.readPixels into a 2D canvas, and writes each frame as a PNG via the
// File System Access API while piping it through a WebCodecs H.264 encoder
// + mp4-muxer into an MP4 loop.
//
// Why render to the canvas instead of a WebGLRenderTarget: the render-target
// path was muting the saturated honey tones — custom ShaderMaterials (the
// galaxy) don't get tone-mapping/color-space chunks applied identically on
// that path, and the highlights were clipping flat. Rendering to the live
// canvas means the export pixels come out of the exact same shader pipeline
// you see on localhost, so colours match. MSAA stays on because we keep the
// existing context (created with antialias:true) — the earlier pitfall was
// creating a *new* context with preserveDrawingBuffer=true, which silently
// disables MSAA on many drivers and made the moving cascade tiles shimmer.
//
// Trigger: Shift+E (4K) or Shift+D (1080p), or call
// `startExport({ width, height, cycles })` from devtools. Output names
// encode the resolution so multiple runs into the same HighResOutput/
// don't collide. Requires Chrome or Edge (FSA API + WebCodecs mp4 support).
//
// Duration is derived from ANIM.timings at export time so it always tracks
// the current animation sequence. See `computeCycleSeconds` below.

import { ANIM } from '../config.js';

const FPS            = 60;
const PREROLL_SEC    = 10.0;         // warm up stateful spark systems
const PREROLL_FRAMES = Math.round(PREROLL_SEC * FPS);    // 600
const DT             = 1 / FPS;
// Bitrate scales with pixel throughput — 50 Mbps at 4K60 ≈ 12.5 Mbps at 1080p60.
const REF_PIXELS_PER_SEC = 3840 * 2160 * 60;
const REF_BITRATE        = 50_000_000;

let running = false;

// Mirror of the period formula in src/patterns-layer.js — one full per-tile
// cycle is `rest + out + gap + in`, where `gap` auto-extends to the overlay
// morph total (brickHold + brickToRose + roseHold + roseToBrick) whenever
// `playAll` is on. Keeping this in sync with patterns-layer means tweaking
// any of those knobs in config immediately changes export length.
function computeCycleSeconds() {
  const t       = ANIM.timings ?? {};
  const cascade = t.cascade   ?? {};
  const overlay = t.overlay   ?? {};
  const gap = t.playAll
    ? (overlay.brickHold   || 0) + (overlay.brickToRose || 0)
    + (overlay.roseHold    || 0) + (overlay.roseToBrick || 0)
    : (cascade.gap || 0);
  return (cascade.rest || 0) + (cascade.out || 0) + gap + (cascade.in || 0);
}

export async function startExport(bridge, opts = {}) {
  if (running) { console.warn('[export] already running'); return; }
  if (!window.showDirectoryPicker) {
    alert('Export requires Chrome or Edge (File System Access API not available).');
    return;
  }

  const WIDTH  = opts.width  ?? 3840;
  const HEIGHT = opts.height ?? 2160;
  const tag    = `${WIDTH}x${HEIGHT}`;
  const MP4_BITRATE = Math.max(
    2_000_000,
    Math.round((WIDTH * HEIGHT * FPS / REF_PIXELS_PER_SEC) * REF_BITRATE),
  );

  // Derive duration + start time from ANIM.timings so the export always
  // captures a clean `cycles` loops of the current animation. `cycles`
  // defaults to 1 (the new 82s sequence at default config).
  const cycles       = opts.cycles ?? 1;
  const cycleSec     = computeCycleSeconds();
  const DURATION_SEC = cycleSec * cycles;
  const START_T      = ANIM.timings?.cascade?.triggerDelay ?? 10.0;
  const TOTAL_FRAMES = Math.round(DURATION_SEC * FPS);
  if (!(DURATION_SEC > 0)) {
    alert(`Export: computed cycle length is ${DURATION_SEC}s — check ANIM.timings.`);
    return;
  }
  console.log(
    `[export] cycle=${cycleSec.toFixed(2)}s × ${cycles} → ${DURATION_SEC.toFixed(2)}s, ${TOTAL_FRAMES} frames`,
  );

  // Loop crossfade: the cascade + overlay morph loop cleanly on `cycleSec`,
  // but non-periodic elements (logo breathing, pattern rotations, particle
  // physics, per-petal shimmer) drift over the cycle and snap at the seam.
  // Fade the first `CROSSFADE_FRAMES` into the last `CROSSFADE_FRAMES` so
  // the tail visually "becomes" the head — the hard jump still exists
  // mathematically at the loop point, but it's masked by the blend.
  // `opts.crossfadeSec` overrides; set to 0 to disable.
  const CROSSFADE_SEC    = opts.crossfadeSec ?? 0.5;
  const CROSSFADE_FRAMES = Math.min(
    Math.max(0, Math.round(CROSSFADE_SEC * FPS)),
    Math.floor(TOTAL_FRAMES / 2),
  );
  // Snapshots of the first CROSSFADE_FRAMES frames, kept as Uint8ClampedArray
  // clones of the (already-flipped) imageData.data. Memory: CROSSFADE_FRAMES
  // × W × H × 4 bytes (~1 GB at 4K/0.5s, ~250 MB at 1080p/0.5s).
  const fadeHead = [];
  if (CROSSFADE_FRAMES > 0) {
    const mb = (CROSSFADE_FRAMES * WIDTH * HEIGHT * 4 / (1024 * 1024)).toFixed(0);
    console.log(`[export] crossfade ${CROSSFADE_SEC}s (${CROSSFADE_FRAMES} frames, ~${mb} MB buffered)`);
  }

  const { ctx, scene, camera, controls, tick, renderer } = bridge;

  // Point-sprite materials bake `uPixelRatio` from the live canvas DPR, so
  // rendering to a higher-res target keeps `gl_PointSize` in live-canvas
  // pixels — particles end up covering a smaller fraction of the frame,
  // which collapses the honey halo into the hot white core and reads as
  // desaturation. Scale the uniform so sprites keep the same frame-relative
  // size (and honey tone) at any export resolution.
  const pointSpriteMats = [
    ctx.particleMats?.emberMat,
    ctx.particleMats?.whiteMat,
    ...(ctx.sparkSystems ?? []).map(s => s?.points?.material),
  ].filter(m => m?.uniforms?.uPixelRatio);
  const savedPixelRatios = pointSpriteMats.map(m => m.uniforms.uPixelRatio.value);

  // 1. Directory picker + nested folders (resolution-tagged so runs coexist).
  let rootHandle;
  try {
    rootHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch {
    return;
  }
  const outHandle = await rootHandle.getDirectoryHandle('HighResOutput',         { create: true });
  const pngHandle = await outHandle.getDirectoryHandle(`PNGsequence_${tag}`,     { create: true });
  const mp4Name   = `logo_loop_${tag}.mp4`;

  running = true;
  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  // 2. Pause live loop + freeze camera. Also pin viewMode to 'visualSequence'
  // for the duration of the export so the captured video always shows the
  // full synchronized sequence — independent of whichever solo mode (1–5)
  // the user might have toggled in the live view.
  ctx.paused = true;
  controls.enabled = false;
  const prevViewMode = ANIM.viewMode;
  ANIM.viewMode = 'visualSequence';

  // 3. Resize the live WebGL canvas to export resolution and render into
  //    it directly. Rendering through a WebGLRenderTarget was losing the
  //    saturated honey tone — custom ShaderMaterials (the galaxy) don't
  //    get tone-mapping/color-space chunks auto-applied the same way on
  //    the render-target path, so highlights clipped flat and the honey
  //    halos read lighter. The canvas path uses the exact pipeline the
  //    live view uses, so export colours match what's on localhost.
  //    MSAA stays on because we use the existing context (antialias:true
  //    was set at create time); creating a new context with
  //    preserveDrawingBuffer is what silently dropped MSAA on the old
  //    path — we're not doing that here.
  const prevPixelRatio   = renderer.getPixelRatio();
  const prevInnerWidth   = window.innerWidth;
  const prevInnerHeight  = window.innerHeight;
  renderer.setPixelRatio(1);
  renderer.setSize(WIDTH, HEIGHT, false);   // false = don't touch CSS, canvas keeps filling the screen

  // 2D canvas used as encoder source (toBlob / VideoFrame). Not shown on
  // screen — the live WebGL canvas itself is the preview now.
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width  = WIDTH;
  captureCanvas.height = HEIGHT;
  const captureCtx = captureCanvas.getContext('2d');
  const pixelBuffer   = new Uint8Array(WIDTH * HEIGHT * 4);
  const imageData     = captureCtx.createImageData(WIDTH, HEIGHT);
  const rowBytes      = WIDTH * 4;
  const gl = renderer.getContext();

  // 4. Camera aspect for export dimensions.
  const prevAspect = camera.aspect;
  camera.aspect = WIDTH / HEIGHT;
  camera.updateProjectionMatrix();

  // Scale point-sprite sizes to match the live frame-relative size at
  // export resolution. Using `innerHeight` (CSS px) rather than DPR keeps
  // the ratio independent of the user's monitor: on any screen, particles
  // occupy the same fraction of frame height as they do live.
  const exportPixelRatio = HEIGHT / Math.max(window.innerHeight, 1);
  pointSpriteMats.forEach(m => { m.uniforms.uPixelRatio.value = exportPixelRatio; });

  // 5. MP4 encoder + muxer (best-effort; PNG sequence still runs if this fails).
  let muxer = null, encoder = null;
  try {
    const mp4muxer = await import('mp4-muxer');
    const Muxer = mp4muxer.Muxer ?? mp4muxer.default?.Muxer;
    const ArrayBufferTarget = mp4muxer.ArrayBufferTarget ?? mp4muxer.default?.ArrayBufferTarget;
    if (!Muxer || !ArrayBufferTarget) throw new Error('mp4-muxer exports missing');
    if (typeof VideoEncoder === 'undefined') throw new Error('VideoEncoder unavailable');

    muxer = new Muxer({
      target:    new ArrayBufferTarget(),
      video:     { codec: 'avc', width: WIDTH, height: HEIGHT, frameRate: FPS },
      fastStart: 'in-memory',
    });
    encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error:  (e)           => console.error('[export] VideoEncoder error:', e),
    });
    encoder.configure({
      codec:     'avc1.640033',
      width:     WIDTH,
      height:    HEIGHT,
      bitrate:   MP4_BITRATE,
      framerate: FPS,
      avc:       { format: 'avc' },
    });
  } catch (e) {
    console.warn('[export] MP4 encoder unavailable; continuing with PNG sequence only:', e);
    encoder = null;
    muxer   = null;
  }

  const startedAt = performance.now();

  try {
    // 6. Pre-roll: 10s of virtual dt=1/60 ticks with no capture so spark
    //    physics reach steady state. Cascade triggers exactly at t=10
    //    (ANIM.rowCascade.triggerDelay), so the first captured frame has
    //    the cascade at cycle-zero.
    for (let i = 0; i < PREROLL_FRAMES; i++) {
      tick((i + 1) * DT, DT);
      if (i % 30 === 0) {
        setOverlayText(overlay, `Pre-roll ${((i + 1) / FPS).toFixed(1)}s / ${PREROLL_SEC}s`);
        await yieldFrame();
      }
    }

    // 7. Capture loop — render to the canvas, read pixels synchronously
    //    via gl.readPixels (same tick, before any compositor swap so the
    //    drawing buffer is still valid without preserveDrawingBuffer),
    //    drop into the 2D capture canvas, encode to PNG + H.264.
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      const t = START_T + frame * DT;
      tick(t, DT);

      renderer.render(scene, camera);
      gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixelBuffer);

      // WebGL origin is bottom-left, Canvas2D is top-left. Flip row order.
      for (let y = 0; y < HEIGHT; y++) {
        const srcStart = (HEIGHT - 1 - y) * rowBytes;
        imageData.data.set(
          pixelBuffer.subarray(srcStart, srcStart + rowBytes),
          y * rowBytes,
        );
      }

      // Crossfade tail into head so the loop closes smoothly. Only the
      // last CROSSFADE_FRAMES are altered; middle frames are raw. Cosine
      // ease keeps the ramp soft at both ends of the fade.
      if (CROSSFADE_FRAMES > 0
          && frame >= TOTAL_FRAMES - CROSSFADE_FRAMES) {
        const headIdx = frame - (TOTAL_FRAMES - CROSSFADE_FRAMES);
        const tNorm   = (headIdx + 0.5) / CROSSFADE_FRAMES;
        const alpha   = 0.5 - 0.5 * Math.cos(Math.PI * tNorm);
        const invA    = 1 - alpha;
        const data    = imageData.data;
        const head    = fadeHead[headIdx];
        for (let p = 0; p < data.length; p += 4) {
          data[p    ] = invA * data[p    ] + alpha * head[p    ];
          data[p + 1] = invA * data[p + 1] + alpha * head[p + 1];
          data[p + 2] = invA * data[p + 2] + alpha * head[p + 2];
        }
      }

      // Stash the (unblended) head frames so the tail can fade into them.
      if (CROSSFADE_FRAMES > 0 && frame < CROSSFADE_FRAMES) {
        fadeHead.push(new Uint8ClampedArray(imageData.data));
      }

      captureCtx.putImageData(imageData, 0, 0);

      // PNG
      const blob = await new Promise(r => captureCanvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error(`[export] toBlob returned null at frame ${frame}`);
      const fname      = `frame_${String(frame).padStart(5, '0')}.png`;
      const fileHandle = await pngHandle.getFileHandle(fname, { create: true });
      const writable   = await fileHandle.createWritable();
      await writable.write(blob);
      await writable.close();

      // MP4 frame
      if (encoder) {
        const vf = new VideoFrame(captureCanvas, {
          timestamp: Math.round(frame * 1_000_000 / FPS),
          duration:  Math.round(1_000_000 / FPS),
        });
        try {
          encoder.encode(vf, { keyFrame: frame % (FPS * 2) === 0 });
        } finally {
          vf.close();
        }
        while (encoder.encodeQueueSize > 8) {
          await new Promise(r => setTimeout(r, 4));
        }
      }

      if (frame % 10 === 0 || frame === TOTAL_FRAMES - 1) {
        const elapsed = (performance.now() - startedAt) / 1000;
        const eta     = elapsed * (TOTAL_FRAMES - frame - 1) / (frame + 1);
        setOverlayText(
          overlay,
          `Capturing ${frame + 1} / ${TOTAL_FRAMES} — ${fmtTime(elapsed)} elapsed, ETA ${fmtTime(eta)}`
        );
        await yieldFrame();
      }
    }

    // 8. Finalise MP4.
    if (encoder && muxer) {
      setOverlayText(overlay, 'Finalising MP4…');
      await yieldFrame();
      try {
        await encoder.flush();
        muxer.finalize();
        const mp4Blob     = new Blob([muxer.target.buffer], { type: 'video/mp4' });
        const mp4File     = await outHandle.getFileHandle(mp4Name, { create: true });
        const mp4Writable = await mp4File.createWritable();
        await mp4Writable.write(mp4Blob);
        await mp4Writable.close();
      } catch (e) {
        console.error('[export] MP4 finalise failed:', e);
      }
    }

    const totalElapsed = (performance.now() - startedAt) / 1000;
    setOverlayText(
      overlay,
      `Done. ${TOTAL_FRAMES} PNGs (${tag}) + MP4 written to HighResOutput/ in ${fmtTime(totalElapsed)}.`
    );
    console.log(`%c[export ${tag}] complete`, 'color:#0a0;font-weight:bold');
    console.log(
      '%cfallback MP4 command (run from inside HighResOutput/):',
      'color:#888'
    );
    console.log(
      `ffmpeg -framerate ${FPS} -i PNGsequence_${tag}/frame_%05d.png ` +
      `-c:v libx264 -crf 15 -pix_fmt yuv420p -movflags +faststart ${mp4Name}`
    );
  } catch (e) {
    console.error('[export] aborted:', e);
    setOverlayText(overlay, `Export failed: ${e.message}. See console.`);
  } finally {
    // 9. Restore.
    renderer.setPixelRatio(prevPixelRatio);
    renderer.setSize(prevInnerWidth, prevInnerHeight);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    pointSpriteMats.forEach((m, i) => { m.uniforms.uPixelRatio.value = savedPixelRatios[i]; });
    controls.enabled = true;
    ctx.paused = false;
    ANIM.viewMode = prevViewMode;
    running = false;
    setTimeout(() => overlay.remove(), 6000);
  }
}

function yieldFrame() {
  return new Promise(r => requestAnimationFrame(() => r()));
}

function fmtTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function buildOverlay() {
  const el = document.createElement('div');
  el.id = 'export-overlay';
  Object.assign(el.style, {
    position:    'fixed',
    bottom:      '20px',
    left:        '20px',
    padding:     '12px 18px',
    background:  'rgba(0,0,0,0.75)',
    color:       '#fff',
    fontFamily:  'ui-monospace, Menlo, Consolas, monospace',
    fontSize:    '13px',
    borderRadius:'8px',
    zIndex:      '9999',
    pointerEvents:'none',
    maxWidth:    'calc(100vw - 40px)',
    border:      '1px solid rgba(255,255,255,0.15)',
    boxShadow:   '0 4px 20px rgba(0,0,0,0.5)',
  });
  el.textContent = 'Export starting…';
  return el;
}

function setOverlayText(el, text) {
  el.textContent = text;
}
