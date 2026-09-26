import * as THREE from 'three';
import { NORD } from './palette.js';
import { footCycle, mix, TAU } from './timeline.js';

const round = new THREE.IcosahedronGeometry(1, 1);
const small = new THREE.IcosahedronGeometry(1, 0);
const axis = new THREE.Vector3(0, 1, 0);
const direction = new THREE.Vector3();
const coat = new THREE.MeshStandardMaterial({ color: NORD.ivory, flatShading: true, roughness: 1 });
const shade = new THREE.MeshStandardMaterial({ color: NORD.snow, flatShading: true, roughness: 1 });
const black = new THREE.MeshStandardMaterial({ color: NORD.night, roughness: 0.86 });
const earInner = new THREE.MeshStandardMaterial({ color: NORD.muted, roughness: 1 });

function mesh(parent, geometry, material, position, scale) {
  const object = new THREE.Mesh(geometry, material);
  object.position.set(...position);
  object.scale.set(...scale);
  object.castShadow = true;
  object.receiveShadow = true;
  parent.add(object);
  return object;
}

// Longitudinal rings make one continuous, deliberately faceted silhouette.
function sculpt(rings, sides = 10) {
  const vertices = [];
  const indices = [];
  rings.forEach(([x, cy, ry, rz], ring) => {
    for (let j = 0; j < sides; j++) {
      const angle = j / sides * TAU;
      vertices.push(x, cy + Math.cos(angle) * ry, Math.sin(angle) * rz);
      if (ring > 0) {
        const a = (ring - 1) * sides + j;
        const b = (ring - 1) * sides + (j + 1) % sides;
        const c = ring * sides + j;
        const d = ring * sides + (j + 1) % sides;
        // Winding points outward, including the underside.
        indices.push(a, b, c, b, d, c);
      }
    }
  });
  for (let j = 1; j < sides - 1; j++) {
    indices.push(0, j + 1, j);
    const end = (rings.length - 1) * sides;
    indices.push(end, end + j, end + j + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  return flat;
}

const torsoGeometry = sculpt([
  [-2.02, 2.02, 0.25, 0.29], [-1.78, 2.06, 0.63, 0.59],
  [-1.2, 2.08, 0.83, 0.76], [-0.42, 2.13, 0.86, 0.81],
  [0.35, 2.2, 0.9, 0.76], [0.92, 2.29, 0.88, 0.65],
  [1.38, 2.38, 0.61, 0.48], [1.84, 2.43, 0.39, 0.33],
  [2.04, 2.43, 0.27, 0.25],
]);
const muzzleGeometry = sculpt([
  [0.06, -0.06, 0.31, 0.33], [0.43, -0.14, 0.26, 0.28],
  [0.83, -0.21, 0.18, 0.22], [1.01, -0.2, 0.14, 0.18],
], 8);

function segment(object, from, to, width, depth) {
  direction.subVectors(to, from);
  object.position.copy(from).add(to).multiplyScalar(0.5);
  object.scale.set(width, direction.length() * 0.68, depth);
  object.quaternion.setFromUnitVectors(axis, direction.normalize());
}

export function createBear({ scale = 1, cub = false } = {}) {
  const root = new THREE.Group();
  root.name = cub ? 'cub' : 'adult';
  root.scale.setScalar(scale);
  const body = new THREE.Group();
  root.add(body);
  mesh(body, torsoGeometry, coat, [0, 0, 0], [1, 1, 1]);
  mesh(body, small, shade, [-2.03, 2.14, 0], [0.22, 0.19, 0.18]);

  const head = new THREE.Group();
  head.position.set(1.79, 2.49, 0);
  if (cub) head.scale.setScalar(1.09);
  body.add(head);
  mesh(head, round, coat, [0.07, 0.015, 0], [0.53, 0.42, 0.37]);
  mesh(head, muzzleGeometry, coat, [0, 0, 0], [1, 1, 1]);
  mesh(head, round, black, [1.015, -0.16, 0], [0.135, 0.113, 0.178]);
  mesh(head, round, shade, [0.54, -0.31, 0], [0.43, 0.095, 0.23]);
  for (const side of [-1, 1]) {
    const ear = mesh(head, round, coat, [-0.15, 0.34, side * 0.28], [0.15, 0.18, 0.12]);
    ear.rotation.x = side * 0.16;
    mesh(head, small, earInner, [-0.09, 0.365, side * 0.33], [0.069, 0.093, 0.026]);
    mesh(head, round, black, [0.35, 0.08, side * 0.31], [0.036, 0.037, 0.021]);
  }

  const legs = [];
  // Offset limbs produce a four-beat, plantigrade walk.
  for (const side of [-1, 1]) {
    for (const front of [false, true]) {
      const x = front ? 0.93 : -1.34;
      const z = side * (front ? 0.48 : 0.51);
      const legMaterial = side < 0 ? shade : coat;
      const upper = mesh(root, round, legMaterial, [0, 0, 0], [1, 1, 1]);
      const lower = mesh(root, round, legMaterial, [0, 0, 0], [1, 1, 1]);
      const joint = mesh(root, round, legMaterial, [0, 0, 0], [0.26, 0.28, 0.25]);
      const shoulder = mesh(body, round, legMaterial, [x, 1.9, z], [front ? 0.35 : 0.42, 0.62, 0.29]);
      const paw = mesh(root, round, legMaterial, [0, 0, 0], [0.36, 0.17, 0.27]);
      legs.push({ front, side, x, z, upper, lower, joint, shoulder, paw,
        hip: new THREE.Vector3(), knee: new THREE.Vector3(), ankle: new THREE.Vector3(),
        phase: (front ? 0 : 0.73) + (side < 0 ? 0.5 : 0),
      });
    }
  }

  function update(time, phase, run = 0, stride = 1.2) {
    const angle = phase * TAU;
    const bounce = mix(0.026 * Math.cos(angle * 2), 0.12 + 0.12 * Math.cos(angle * 2), run);
    const pitch = Math.sin(angle) * mix(0.013, 0.045, run);
    body.position.y = bounce;
    body.rotation.z = pitch;
    body.rotation.x = Math.sin(angle) * 0.018 * (1 - run);
    head.rotation.z = -0.028 + Math.sin(angle + 0.6) * 0.025;
    head.rotation.y = Math.sin(angle * 0.5) * 0.014;
    body.updateMatrix();

    for (const leg of legs) {
      // Running blends into a gathered gallop while retaining a continuous phase.
      const offset = mix(leg.phase, (leg.front ? 0 : 0.5) + (leg.side < 0 ? 0.1 : 0), run);
      const step = footCycle(phase + offset, stride, run);
      leg.hip.set(leg.x, 1.95, leg.z).applyMatrix4(body.matrix);
      leg.ankle.set(leg.x + step.x, 0.27 + step.y, leg.z);
      const dx = leg.ankle.x - leg.hip.x;
      const dy = leg.ankle.y - leg.hip.y;
      const distance = Math.min(Math.hypot(dx, dy), 1.94);
      const l1 = 0.95;
      const l2 = 0.91;
      const along = (l1 * l1 - l2 * l2 + distance * distance) / (2 * distance);
      const bend = Math.sqrt(Math.max(0, l1 * l1 - along * along));
      const ux = dx / Math.hypot(dx, dy);
      const uy = dy / Math.hypot(dx, dy);
      const sign = leg.front ? -1 : 1;
      leg.knee.set(leg.hip.x + ux * along - uy * bend * sign,
        leg.hip.y + uy * along + ux * bend * sign, leg.z);
      segment(leg.upper, leg.hip, leg.knee, leg.front ? 0.29 : 0.33, 0.28);
      segment(leg.lower, leg.knee, leg.ankle, 0.205, 0.21);
      leg.joint.position.copy(leg.knee);
      leg.paw.position.copy(leg.ankle);
      leg.paw.position.x += 0.12;
      leg.paw.position.y -= 0.105;
      leg.paw.rotation.z = -step.y * 0.3;
    }
  }
  return { root, body, head, update };
}
