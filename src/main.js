import * as THREE from 'three';
import './style.css';
import { createBear, loadBearAsset, poseSharedGlance } from './bear.js';
import { createBird } from './bird.js';
import { createWorld } from './world.js';
import { CUB_SCALE, CUB_LANE_Z, LOOP_DURATION, WALK_PERIOD, cubState, sharedGlance, mod } from './timeline.js';

const canvas = document.querySelector('#scene');
const stage = document.querySelector('#stage');
const toggle = document.querySelector('#toggle');
const restart = document.querySelector('#restart');
const slider = document.querySelector('#timeline');
const timeLabel = document.querySelector('#time');
const error = document.querySelector('#scene-error');
const loading = document.querySelector('#scene-loading');
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

async function start() {
  let asset;
  try {
    asset = await loadBearAsset(`${import.meta.env.BASE_URL}models/bear.glb`);
  } catch (cause) {
    throw new Error('The bear model could not be loaded. Please refresh to try again.', { cause });
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-9, 9, 5, -5, 0.1, 100);
  const world = createWorld(scene);
  const adult = createBear(asset);
  const cub = createBear(asset, { scale: CUB_SCALE, cub: true });
  const bird = createBird();
  scene.add(adult.root, cub.root, bird.root);
  adult.root.position.x = -0.35;
  cub.root.position.z = CUB_LANE_Z;
  let elapsed = 0;
  let previous = null;
  let playing = !reducedMotion.matches;
  let lost = false;
  let uiSecond = -1;

  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    const aspect = width / height;
    const viewWidth = Math.max(11.2, Math.min(23, 10.2 * aspect));
    const viewHeight = viewWidth / aspect;
    camera.left = -viewWidth / 2;
    camera.right = viewWidth / 2;
    camera.top = viewHeight / 2;
    camera.bottom = -viewHeight / 2;
    // More headroom below on portrait screens leaves space for the captions.
    const targetY = aspect < 0.85 ? -0.05 : 1.55;
    camera.position.set(4.5, targetY + 4.5, 18);
    camera.lookAt(0, targetY, 0);
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height, false);
    draw();
  }

  function draw() {
    if (lost) return;
    const time = mod(elapsed, LOOP_DURATION);
    adult.update(time, time / WALK_PERIOD);
    const state = cubState(time);
    cub.root.visible = state.visible;
    cub.root.position.x = state.x;
    cub.update(time, state.phase, state.run, state.stride);
    poseSharedGlance(adult, cub, sharedGlance(time));
    bird.update(time, adult);
    adult.followBird(time, bird.root.position);
    world.update(time);
    renderer.render(scene, camera);
    slider.value = String(time);
    slider.style.setProperty('--progress', `${time / LOOP_DURATION * 100}%`);
    const second = Math.floor(time);
    if (uiSecond !== second) {
      timeLabel.textContent = `00:${String(second).padStart(2, '0')}`;
      slider.setAttribute('aria-valuetext', `${second} seconds of ${LOOP_DURATION}`);
      uiSecond = second;
    }
  }

  function setPlaying(value) {
    playing = value;
    previous = null;
    toggle.setAttribute('aria-label', playing ? 'Pause animation' : 'Play animation');
    toggle.title = playing ? 'Pause (Space)' : 'Play (Space)';
    document.querySelector('#pause-icon').toggleAttribute('hidden', !playing);
    document.querySelector('#play-icon').toggleAttribute('hidden', playing);
  }
  const onToggle = () => setPlaying(!playing);
  const onRestart = () => { elapsed = 0; previous = null; draw(); };
  const onSeek = () => { elapsed = Number(slider.value); previous = null; draw(); };
  const onKey = (event) => {
    if (event.code === 'Space' && !['INPUT', 'BUTTON', 'TEXTAREA'].includes(document.activeElement.tagName)) {
      event.preventDefault();
      onToggle();
    }
  };
  const onVisibility = () => { previous = null; };
  const onReducedMotion = () => { if (reducedMotion.matches) setPlaying(false); };
  const onLost = (event) => { event.preventDefault(); lost = true; error.hidden = false; };
  const onRestored = () => { lost = false; error.hidden = true; previous = null; draw(); };
  toggle.addEventListener('click', onToggle);
  restart.addEventListener('click', onRestart);
  slider.addEventListener('input', onSeek);
  document.addEventListener('keydown', onKey);
  document.addEventListener('visibilitychange', onVisibility);
  reducedMotion.addEventListener('change', onReducedMotion);
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  setPlaying(playing);
  const observer = new ResizeObserver(resize);
  observer.observe(stage);
  resize();
  loading.hidden = true;
  stage.setAttribute('aria-busy', 'false');
  toggle.disabled = false;
  restart.disabled = false;
  slider.disabled = false;
  renderer.setAnimationLoop((timestamp) => {
    if (document.hidden || lost) { previous = null; return; }
    const delta = previous === null ? 0 : (timestamp - previous) / 1000;
    previous = timestamp;
    if (playing) {
      elapsed = mod(elapsed + delta, LOOP_DURATION);
      draw();
    }
  });

  if (import.meta.env.DEV) {
    // Deterministic poses for visual review, without waiting through each loop.
    const params = new URLSearchParams(location.search);
    if (params.has('time')) { elapsed = Number(params.get('time')) || 0; setPlaying(false); draw(); }
    window.__north = { scene, camera, renderer, adult, cub, bird,
      seek(time) { elapsed = time; setPlaying(false); draw(); },
      play() { setPlaying(true); },
      get time() { return elapsed; },
    };
  }

  function dispose() {
    renderer.setAnimationLoop(null);
    observer.disconnect();
    toggle.removeEventListener('click', onToggle);
    restart.removeEventListener('click', onRestart);
    slider.removeEventListener('input', onSeek);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('visibilitychange', onVisibility);
    reducedMotion.removeEventListener('change', onReducedMotion);
    canvas.removeEventListener('webglcontextlost', onLost);
    canvas.removeEventListener('webglcontextrestored', onRestored);
    const geometries = new Set();
    const materials = new Set();
    scene.traverse((object) => {
      if (object.geometry) geometries.add(object.geometry);
      if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach((m) => materials.add(m));
      if (object.isLight && object.shadow) object.shadow.dispose();
      if (object.isInstancedMesh) object.dispose();
    });
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    adult.dispose();
    cub.dispose();
    renderer.dispose();
    delete window.__north;
  }
  if (import.meta.hot) import.meta.hot.dispose(dispose);
}

start().catch((cause) => {
  console.error('Could not start the scene:', cause);
  error.hidden = false;
  if (cause.cause) error.textContent = cause.message;
  loading.hidden = true;
  stage.setAttribute('aria-busy', 'false');
  toggle.disabled = true;
  restart.disabled = true;
  slider.disabled = true;
});
