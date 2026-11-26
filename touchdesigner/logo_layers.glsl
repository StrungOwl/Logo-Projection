// LAYERS - puts three copies of the show together, one per wood layer.
// GLSL TOP 'mix' in /project1/logo.  Inputs:
//   0 story (web)   1 accent 1 (web2)   2 accent 2 (web3)
//   3 zonesA: red = layer 1, green = layer 2, blue = layer 3
//   4 zonesB: red = layer 4, green = shadow lines, blue = light lines
// uW0..uW4 = for each wood layer, how much of each copy (x story, y accent 1, z accent 2).
// uMisc.x  = wood lines on (1) or off (0).
// The numbers come from touchdesigner/logo_layers.py, every frame.
uniform vec3 uW0;
uniform vec3 uW1;
uniform vec3 uW2;
uniform vec3 uW3;
uniform vec3 uW4;
uniform vec3 uMisc;
out vec4 fragColor;

vec3 pick(vec3 k, vec3 a, vec3 b, vec3 c) { return a * k.x + b * k.y + c * k.z; }

void main() {
  vec2 uv = vUV.st;
  vec3 a = texture(sTD2DInputs[0], uv).rgb;
  vec3 b = texture(sTD2DInputs[1], uv).rgb;
  vec3 c = texture(sTD2DInputs[2], uv).rgb;
  vec3 m = texture(sTD2DInputs[3], uv).rgb;
  vec3 x = texture(sTD2DInputs[4], uv).rgb;
  vec3 col = pick(uW0, a, b, c);
  col = mix(col, pick(uW1, a, b, c), m.r);
  col = mix(col, pick(uW2, a, b, c), m.g);
  col = mix(col, pick(uW3, a, b, c), m.b);
  col = mix(col, pick(uW4, a, b, c), x.r);
  col *= 1.0 - uMisc.x * 0.50 * x.g;       // shadow under a wood step
  col += uMisc.x * 0.45 * x.b * col;       // light on the edge of a wood step
  fragColor = TDOutputSwizzle(vec4(col, 1.0));
}
