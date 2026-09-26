import * as THREE from 'three';
import { NORD } from './palette.js';
import { GROUND_REPEAT, GROUND_SPEED, mod, TAU } from './timeline.js';

function random(seed) {
  let state = seed;
  return () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
}

export function createWorld(scene) {
  scene.background = new THREE.Color(NORD.night);
  const sky = new THREE.HemisphereLight(NORD.white, NORD.muted, 2.1);
  scene.add(sky);
  const key = new THREE.DirectionalLight(NORD.ivory, 2.6);
  key.position.set(-3, 8, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -11, right: 11, top: 7, bottom: -7, near: 0.1, far: 24 });
  key.shadow.normalBias = 0.025;
  key.shadow.bias = -0.00015;
  key.shadow.radius = 4;
  key.target.position.set(0, 1, 0);
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(NORD.ice, 1.6);
  rim.position.set(1, 4, -5);
  scene.add(rim);

  // A quiet pool of ground, feathering into the exact background color.
  const vertices = [0, -0.015, 0];
  const colors = [];
  const indices = [];
  const inner = new THREE.Color(NORD.slate);
  const outer = new THREE.Color(NORD.night);
  colors.push(inner.r, inner.g, inner.b);
  const count = 64;
  for (let ring = 0; ring < 3; ring++) {
    const radius = [0.45, 0.72, 1][ring];
    const color = inner.clone().lerp(outer, [0, 0.45, 1][ring]);
    for (let i = 0; i < count; i++) {
      const angle = i / count * TAU;
      vertices.push(Math.cos(angle) * 15 * radius, -0.015, Math.sin(angle) * 5.5 * radius);
      colors.push(color.r, color.g, color.b);
      const current = 1 + ring * count + i;
      const next = 1 + ring * count + (i + 1) % count;
      if (ring === 0) indices.push(0, next, current);
      else indices.push(current - count, next, current, current - count, next - count, next);
    }
  }
  const groundGeometry = new THREE.BufferGeometry();
  groundGeometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  groundGeometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  groundGeometry.setIndex(indices);
  const ground = new THREE.Mesh(groundGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
  scene.add(ground);
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(50, 22), new THREE.ShadowMaterial({ color: NORD.night, opacity: 0.32 }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.001;
  shadow.receiveShadow = true;
  scene.add(shadow);

  const rand = random(47);
  const stoneGeometry = new THREE.IcosahedronGeometry(1, 0);
  const stoneMaterial = new THREE.MeshStandardMaterial({ color: NORD.muted, flatShading: true, roughness: 1 });
  const stones = new THREE.InstancedMesh(stoneGeometry, stoneMaterial, 54);
  stones.castShadow = true;
  stones.receiveShadow = true;
  stones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  // Position changes are bounded by the three repeated tiles.
  stones.frustumCulled = false;
  const seeds = Array.from({ length: 18 }, () => ({
    x: rand() * GROUND_REPEAT,
    z: (rand() > 0.5 ? 1 : -1) * (1.5 + rand() * 2.5),
    scale: 0.06 + rand() * 0.18,
    rotation: rand() * TAU,
  }));
  for (let i = 0; i < 54; i++) stones.setColorAt(i, new THREE.Color(i % 5 === 0 ? NORD.blue : NORD.muted));
  scene.add(stones);
  const dummy = new THREE.Object3D();

  // Thin, broken ice seams convey steady travel without distracting particles.
  const seams = [];
  const seamMaterial = new THREE.LineBasicMaterial({ color: NORD.blue, transparent: true, opacity: 0.16 });
  for (let i = 0; i < 9; i++) {
    const geometry = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-0.5, 0.009, -0.09), new THREE.Vector3(0, 0.009, 0),
      new THREE.Vector3(0.7, 0.009, 0.06), new THREE.Vector3(1.1, 0.009, -0.02),
    ]);
    const line = new THREE.Line(geometry, seamMaterial);
    line.position.z = [-2.7, 2.5, 3.4][i % 3];
    scene.add(line);
    seams.push(line);
  }

  function update(time) {
    const offset = mod(time * GROUND_SPEED, GROUND_REPEAT);
    let index = 0;
    for (let tile = -1; tile <= 1; tile++) {
      for (const seed of seeds) {
        const x = mod(seed.x - offset, GROUND_REPEAT) - GROUND_REPEAT / 2 + tile * GROUND_REPEAT;
        dummy.position.set(x, seed.scale * 0.15, seed.z);
        dummy.rotation.set(0, seed.rotation, 0);
        // Fade the size only outside the central stage; repetition stays offscreen.
        const fade = Math.max(0, 1 - (Math.abs(x) / 16) ** 6);
        dummy.scale.set(seed.scale * 1.6 * fade, seed.scale * 0.32 * fade, seed.scale * fade);
        dummy.updateMatrix();
        stones.setMatrixAt(index++, dummy.matrix);
      }
    }
    stones.instanceMatrix.needsUpdate = true;
    seams.forEach((line, i) => {
      line.position.x = mod((i % 3) * 6.4 - offset, GROUND_REPEAT) - GROUND_REPEAT / 2 + (Math.floor(i / 3) - 1) * GROUND_REPEAT;
    });
  }
  return { update };
}
