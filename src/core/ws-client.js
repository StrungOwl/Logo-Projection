// Minimal WebSocket client with forever-reconnect. The app is the CLIENT:
// TouchDesigner runs a WebSocket DAT in server mode (python -m http.server
// can't serve websockets), so connection direction is app → TD. Silent by
// design — a missing server just retries on backoff (1s → 2s → 5s cap)
// so the app can boot before TD, or run without it entirely.

export function initWsClient({ url, onMessage, onOpen }) {
  let ws = null;
  let closed = false;
  let attempt = 0;
  const BACKOFF = [1000, 2000, 5000];

  function connect() {
    if (closed) return;
    try {
      ws = new WebSocket(url);
    } catch {
      return scheduleReconnect();
    }
    ws.onopen = () => {
      attempt = 0;
      console.log(`[ws] connected to ${url}`);
      onOpen?.();
    };
    ws.onmessage = (e) => {
      let msg;
      try { msg = JSON.parse(e.data); } catch { return; }
      onMessage?.(msg);
    };
    ws.onclose = scheduleReconnect;
    ws.onerror = () => { try { ws.close(); } catch { /* already closing */ } };
  }

  function scheduleReconnect() {
    if (closed) return;
    const delay = BACKOFF[Math.min(attempt++, BACKOFF.length - 1)];
    setTimeout(connect, delay);
  }

  connect();

  return {
    send(obj) {
      if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
    },
    close() { closed = true; try { ws?.close(); } catch { /* noop */ } },
  };
}
