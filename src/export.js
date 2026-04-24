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
//    Or from devtools:  startExport()            (4K)
//                       startExport1080p()       (1080p)
//                       startExport({ width, height })   (custom)
// 5. A directory picker appears — pick any folder (project root, Desktop,
//    etc.). A `HighResOutput/` folder is created there if it doesn't
//    already exist.
// 6. The live canvas is replaced by a scaled preview of the capture and a
//    progress overlay shows frame count + ETA. Expect roughly 6–12 minutes
//    for 4K, 2–4 minutes for 1080p, depending on disk speed.
// 7. When it finishes, the picked folder contains:
//        HighResOutput/
//        ├── PNGsequence_<W>x<H>/
//        │   ├── frame_00000.png
//        │   └── … through frame_05099.png   (5100 frames = 85 s @ 60 fps)
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
// Deterministic offline export. Pauses the live loop, renders the scene
// via the *existing* WebGLRenderer into a 4× multisampled WebGLRenderTarget
// sized to the export resolution, reads pixels back into a 2D canvas, and
// writes each frame as a PNG via the File System Access API while piping
// it through a WebCodecs H.264 encoder + mp4-muxer into an MP4 loop.
//
// Rendering through the original renderer (instead of spinning up a second
// one with preserveDrawingBuffer=true) is what keeps MSAA on — swapping to
// a new WebGL context with preserveDrawingBuffer silently drops antialias
// on many drivers, which made the moving cascade tiles shimmer.
//
// Trigger: Shift+E (4K) or Shift+D (1080p), or call
// `startExport({ width, height })` from devtools. Output names encode the
// resolution so multiple runs into the same HighResOutput/ don't collide.
// Requires Chrome or Edge (FSA API + WebCodecs mp4 support).

import * as THREE from 'three';

const FPS            = 60;
const DURATION_SEC   = 85.0;         // 2× row-cascade cycle (42.5s each)
const START_T        = 10.0;         // ANIM.rowCascade.triggerDelay
const PREROLL_SEC    = 10.0;         // warm up stateful spark systems
const TOTAL_FRAMES   = Math.round(DURATION_SEC * FPS);   // 5100
const PREROLL_FRAMES = Math.round(PREROLL_SEC * FPS);    // 600
const DT             = 1 / FPS;
const MSAA_SAMPLES   = 4;
// Bitrate scales with pixel throughput — 50 Mbps at 4K60 ≈ 12.5 Mbps at 1080p60.
const REF_PIXELS_PER_SEC = 3840 * 2160 * 60;
const REF_BITRATE        = 50_000_000;

let running = false;

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

  const { ctx, scene, camera, controls, tick, renderer } = bridge;

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

  // 2. Pause live loop + freeze camera.
  ctx.paused = true;
  controls.enabled = false;

  // 3. Multisampled render target — this is the key difference from v1.
  //    `samples: 4` gives us 4× MSAA so the moving cascade tile edges stop
  //    shimmering. `colorSpace: SRGBColorSpace` tells three.js to apply the
  //    linear→sRGB encode in the shader so readback pixels are display-ready
  //    (matches whatever the live canvas was outputting).
  const target = new THREE.WebGLRenderTarget(WIDTH, HEIGHT, {
    samples:   MSAA_SAMPLES,
    type:      THREE.UnsignedByteType,
    format:    THREE.RGBAFormat,
    colorSpace: renderer.outputColorSpace ?? THREE.SRGBColorSpace,
  });

  // 2D canvas used both as capture source (toBlob / VideoFrame) and as the
  // on-screen preview during export. The live canvas gets hidden while
  // export runs and is restored in the finally block.
  const captureCanvas = document.createElement('canvas');
  captureCanvas.width  = WIDTH;
  captureCanvas.height = HEIGHT;
  const captureCtx = captureCanvas.getContext('2d');
  const pixelBuffer   = new Uint8Array(WIDTH * HEIGHT * 4);
  const imageData     = captureCtx.createImageData(WIDTH, HEIGHT);
  const rowBytes      = WIDTH * 4;

  Object.assign(captureCanvas.style, {
    position: 'fixed',
    inset:    '0',
    width:    '100vw',
    height:   '100vh',
    zIndex:   '1',
  });
  renderer.domElement.style.display = 'none';
  document.body.appendChild(captureCanvas);

  // 4. Camera aspect for export dimensions.
  const prevAspect = camera.aspect;
  camera.aspect = WIDTH / HEIGHT;
  camera.updateProjectionMatrix();

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

    // 7. Capture loop — render to MSAA target, read pixels (flip Y),
    //    drop into the 2D capture canvas, encode to PNG + H.264.
    for (let frame = 0; frame < TOTAL_FRAMES; frame++) {
      const t = START_T + frame * DT;
      tick(t, DT);

      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(target, 0, 0, WIDTH, HEIGHT, pixelBuffer);
      renderer.setRenderTarget(null);

      // WebGL origin is bottom-left, Canvas2D is top-left. Flip row order.
      for (let y = 0; y < HEIGHT; y++) {
        const srcStart = (HEIGHT - 1 - y) * rowBytes;
        imageData.data.set(
          pixelBuffer.subarray(srcStart, srcStart + rowBytes),
          y * rowBytes,
        );
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
    renderer.setRenderTarget(null);
    target.dispose();
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    renderer.domElement.style.display = '';
    captureCanvas.remove();
    controls.enabled = true;
    ctx.paused = false;
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
