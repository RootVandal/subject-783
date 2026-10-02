// Full-screen view from inside the subject: two cameras (left / right compound eye) rendered
// side by side, then resampled into a hex mosaic of ommatidia. Each facet reads the shared
// facet mask, so it goes dark when its photoreceptor or optic-lobe neuron is blocked in the
// model. Global degradation (tunnel, desaturation) follows the fraction of the visual system
// that still fires.
import * as THREE from 'three';
import { EYE_GLSL } from './scene/monitors.js';

const frag = /* glsl */ `
  uniform sampler2D tEye;
  uniform float uTime, uAlive, uSeizure, uFade, uAspect, uCell, uFlash, uRed, uGain;
  uniform vec2 uShake;
  varying vec2 vUv;
  ${EYE_GLSL}

  vec3 sampleEye(vec2 q, float e, float blur) {
    // q: eye coordinates (-1..1); mild fisheye
    float r2 = dot(q, q);
    vec2 qq = q * (1.0 + 0.18 * r2);
    vec2 uv = vec2((e + clamp(qq.x * 0.5 + 0.5, 0.001, 0.999)) * 0.5, clamp(qq.y * 0.5 + 0.5, 0.001, 0.999));
    vec3 c = texture2D(tEye, uv).rgb;
    if (blur > 0.0) {
      c += texture2D(tEye, uv + vec2(blur, 0.0)).rgb + texture2D(tEye, uv - vec2(blur, 0.0)).rgb
         + texture2D(tEye, uv + vec2(0.0, blur * 2.0)).rgb + texture2D(tEye, uv - vec2(0.0, blur * 2.0)).rgb;
      c /= 5.0;
    }
    return c;
  }

  void main() {
    vec2 uv = vUv + uShake;
    float e = step(0.5, uv.x);
    // pixel space in units of the facet size, regular hexagons
    vec2 hp = vec2(uv.x * uAspect, uv.y) / uCell;
    vec4 h = hexCoords(hp);
    vec2 cuv = vec2(h.z * uCell / uAspect, h.w * uCell);        // facet centre (screen uv)
    vec2 q = vec2((uv.x - (e * 0.5 + 0.25)) / 0.25, (uv.y - 0.5) / 0.5);
    vec2 qc = vec2((cuv.x - (e * 0.5 + 0.25)) / 0.25, (cuv.y - 0.5) / 0.5);
    float blur = (1.0 - uAlive) * 0.012;
    vec3 cellCol = sampleEye(qc, e, blur);
    vec3 fine = sampleEye(q, e, blur);
    vec3 col = mix(cellCol, fine, 0.3) * uGain;
    col = col / (1.0 + 0.35 * col);
    // facet mask: blocked neurons -> dark facet, dying neurons flash
    vec4 mk = facetMask(qc, e);
    float fh = hash(h.zw + floor(uTime * 24.0));
    col *= 1.0 - max(mk.r, mk.b * 0.9);
    col += vec3(1.0, 0.85, 0.7) * mk.g * (0.5 + 0.5 * fh);
    col += vec3(0.08, 0.0, 0.0) * mk.r * fh * (1.0 - uFade);
    // seizure: random facets fire white, colour channels split
    float burst = step(1.0 - 0.18 * uSeizure, fh) * uSeizure;
    col = mix(col, vec3(1.0, 0.95, 0.9) * (1.2 + fh), burst);
    col.r += uSeizure * 0.25 * sin(uTime * 40.0 + h.z);
    // lens of each facet
    float edge = smoothstep(0.36, 0.5, hexDist(h.xy));
    float lensHi = 1.0 - 0.35 * dot(h.xy, h.xy) * 2.0;
    col = col * lensHi * (1.0 - edge * 0.8);
    // the two eyes, separated by a dark seam; tunnel closes as the visual system dies
    float d = length(q * vec2(1.0, 1.05));
    float rim = mix(0.25, 1.02, smoothstep(0.0, 1.0, uAlive));
    col *= smoothstep(rim, rim - 0.18, d);
    // dying: desaturate, darken, red vignette
    float g = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(g), col, 0.35 + 0.65 * uAlive);
    col *= 0.35 + 0.65 * uAlive;
    col = mix(col, col * vec3(1.4, 0.45, 0.4), uRed * smoothstep(0.2, 1.0, d));
    col += uFlash * vec3(1.0);
    col += (hash(vUv * 900.0 + uTime) - 0.5) * 0.05;
    col *= 1.0 - uFade;
    gl_FragColor = vec4(max(col, 0.0), 1.0);
  }
`;

export function createPOV({ fly, mask }) {
  const rt = new THREE.WebGLRenderTarget(1024, 512);
  rt.texture.colorSpace = THREE.SRGBColorSpace;
  const cams = [new THREE.PerspectiveCamera(108, 1, 0.03, 80), new THREE.PerspectiveCamera(108, 1, 0.03, 80)];
  cams.forEach((c) => c.layers.enable(1));
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tEye: { value: rt.texture }, uMask: { value: mask }, uTime: { value: 0 }, uAlive: { value: 1 }, uSeizure: { value: 0 },
      uFade: { value: 0 }, uAspect: { value: 16 / 9 }, uCell: { value: 1 / 40 }, uFlash: { value: 0 }, uRed: { value: 0 },
      uGain: { value: 4.2 }, uShake: { value: new THREE.Vector2() },
    },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: frag, depthTest: false, depthWrite: false, toneMapped: false,
  });
  scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat));
  const pos = new THREE.Vector3(), quat = new THREE.Quaternion();
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

  function render(renderer, world, now, info) {
    const u = mat.uniforms;
    u.uTime.value = now;
    u.uAlive.value = info.alive;
    u.uSeizure.value = info.seizure;
    u.uFade.value = info.fade;
    u.uFlash.value = info.flash;
    u.uRed.value = info.red;
    u.uAspect.value = innerWidth / innerHeight;
    u.uShake.value.set((Math.random() - 0.5) * info.shake * 0.02, (Math.random() - 0.5) * info.shake * 0.02);
    fly.eyeAnchor.getWorldPosition(pos);
    fly.eyeAnchor.getWorldQuaternion(quat);
    fly.headParts.forEach((m) => { m.visible = false; });
    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    rt.scissorTest = true;
    cams.forEach((c, e) => {
      c.position.copy(pos);
      c.quaternion.copy(quat).multiply(turn);
      c.rotateY(e === 0 ? 0.4 : -0.4);      // left eye looks to the subject's left
      c.rotateX(-0.06);
      rt.viewport.set(e * 512, 0, 512, 512);
      rt.scissor.set(e * 512, 0, 512, 512);
      renderer.setRenderTarget(rt);
      renderer.render(world, c);
    });
    rt.scissorTest = false;
    rt.viewport.set(0, 0, 1024, 512);
    renderer.setRenderTarget(prevTarget);
    fly.headParts.forEach((m) => { m.visible = true; });
  }

  return { scene, camera, render, material: mat };
}
