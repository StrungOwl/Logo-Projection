// Hex → shader RGB array. Accepts '#RRGGBB', '#RGB', or an already-parsed
// [r, g, b] float triple (pass-through) so callers can feed either form.
// Output is always a fresh [r, g, b] with components in 0..1 — the format
// shader uniforms / Vector3 spreads expect.
export function hexToRgb(hex) {
  if (Array.isArray(hex)) return hex.slice(0, 3);
  if (typeof hex !== 'string') throw new Error('hexToRgb: expected string or array, got ' + typeof hex);
  let h = hex.trim();
  if (h.startsWith('#')) h = h.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');   // '#f90' -> 'ff9900'
  if (h.length !== 6) throw new Error('hexToRgb: invalid hex ' + hex);
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
