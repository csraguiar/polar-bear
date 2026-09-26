import * as THREE from 'three';
import { NORD } from './palette.js';
import { birdState, mix, smooth, smoother, TAU } from './timeline.js';

const geometry = new THREE.IcosahedronGeometry(1, 1);
const material = (color) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true });
const blue = material(NORD.blue);
const dark = material(NORD.deepBlue);
const pale = material(NORD.snow);
const ink = material(NORD.night);
const destination = new THREE.Vector3();
const flight = new THREE.Vector3();
const landing = new THREE.Vector3(-0.42, 2.947, 0.13);
const arrival = new THREE.CubicBezierCurve3(
  new THREE.Vector3(-19, 3.8, -1.5), new THREE.Vector3(-9, 8.5, -1.8),
  new THREE.Vector3(-2.5, 3.8, 0.13), new THREE.Vector3(0, 0, 0),
);
const departure = new THREE.CubicBezierCurve3(
  new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.1, 2, 0),
  new THREE.Vector3(8, 5.8, -1), new THREE.Vector3(21, 4, -2),
);

export function createBird() {
  const root = new THREE.Group();
  root.name = 'bird';
  function part(parent, mat, position, scale) {
    const obj = new THREE.Mesh(geometry, mat);
    obj.position.set(...position);
    obj.scale.set(...scale);
    obj.castShadow = true;
    parent.add(obj);
    return obj;
  }
  const body = new THREE.Group();
  root.add(body);
  part(body, blue, [0, 0.2, 0], [0.28, 0.18, 0.15]);
  part(body, pale, [0.12, 0.16, 0], [0.18, 0.13, 0.132]);
  const head = new THREE.Group();
  head.position.set(0.21, 0.34, 0);
  body.add(head);
  part(head, blue, [0, 0, 0], [0.145, 0.14, 0.13]);
  part(head, ink, [0.075, 0.015, 0.11], [0.017, 0.019, 0.012]);
  part(head, ink, [0.075, 0.015, -0.11], [0.017, 0.019, 0.012]);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.045, 0.16, 4), ink);
  beak.rotation.z = -Math.PI / 2;
  beak.position.set(0.17, -0.015, 0);
  head.add(beak);
  const tail = part(body, dark, [-0.34, 0.21, 0], [0.26, 0.035, 0.12]);
  tail.rotation.z = -0.16;
  const wings = [-1, 1].map((side) => {
    const wing = new THREE.Group();
    wing.position.set(-0.04, 0.25, side * 0.105);
    const shape = new THREE.BufferGeometry();
    shape.setAttribute('position', new THREE.Float32BufferAttribute([
      0.12, 0, 0, -0.12, 0.02, side * 0.4, -0.61, -0.04, side * 0.73,
      0.12, 0, 0, -0.61, -0.04, side * 0.73, -0.34, -0.01, side * 0.13,
    ], 3));
    shape.computeVertexNormals();
    const wingMat = dark.clone();
    wingMat.side = THREE.DoubleSide;
    const surface = new THREE.Mesh(shape, wingMat);
    surface.castShadow = true;
    wing.add(surface);
    body.add(wing);
    return { wing, side };
  });
  for (const side of [-1, 1]) {
    part(root, ink, [0.08, 0.06, side * 0.065], [0.016, 0.075, 0.013]);
    part(root, ink, [0.115, 0.012, side * 0.065], [0.07, 0.012, 0.028]);
  }

  function update(time, bear) {
    const state = birdState(time);
    root.visible = state.mode !== 'hidden';
    if (!root.visible) return;
    bear.body.updateWorldMatrix(true, false);
    destination.copy(landing).applyMatrix4(bear.body.matrixWorld);
    root.position.copy(destination);
    let flying = 0;
    let tilt = 0;
    if (state.mode === 'arriving') {
      const progress = smoother(state.progress);
      arrival.getPoint(progress, flight);
      // The curve is relative to the moving perch, giving a continuous touchdown.
      root.position.add(flight);
      flying = 1 - smooth((state.progress - 0.79) / 0.21);
      tilt = 0.13 * Math.sin(state.progress * Math.PI);
    } else if (state.mode === 'leaving') {
      departure.getPoint(state.progress ** 2, flight);
      root.position.add(flight);
      flying = smooth(state.progress / 0.18);
      tilt = 0.22 * Math.sin(Math.PI * state.progress);
    }
    root.rotation.z = bear.body.rotation.z * (1 - flying) + tilt;
    root.rotation.x = bear.body.rotation.x * (1 - flying);
    body.position.y = (1 - flying) * Math.sin(time * 3.1) * 0.007;
    head.rotation.y = (1 - flying) * (Math.sin(time * 1.7) * 0.16 + Math.sin(time * 3.4) * 0.06);
    head.rotation.z = Math.sin(time * 2.4) * 0.055 * (1 - flying);
    for (const { wing, side } of wings) {
      wing.rotation.x = side * mix(-0.12, Math.sin(time * TAU * 3.5) * 0.95, flying);
      wing.rotation.y = side * mix(-0.95, 0, flying);
      wing.scale.z = mix(0.21, 1, flying);
    }
  }
  return { root, update };
}
