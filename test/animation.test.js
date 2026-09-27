import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { createBear, poseSharedGlance } from '../src/bear.js';
import { createBird } from '../src/bird.js';
import { createWorld } from '../src/world.js';
import { birdHeadMotion, birdState, cubState, sharedGlance, footCycle, CUB_SCALE, CUB_WALK_X, CUB_LANE_Z, CUB_ENTER, CUB_EXIT, GROUND_SPEED, LOOP_DURATION, WALK_PERIOD } from '../src/timeline.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const bytes = await readFile(new URL('../public/models/bear.glb', import.meta.url));
const { scene: asset } = await new GLTFLoader().parseAsync(
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '',
);
const scene = new THREE.Scene();
const adult = createBear(asset);
const cub = createBear(asset, { scale: CUB_SCALE, cub: true });
const bird = createBird();
const world = createWorld(scene);
scene.add(adult.root, cub.root, bird.root);
adult.root.position.x = -0.35;

function pose(time) {
  adult.update(time, time / WALK_PERIOD);
  const state = cubState(time);
  cub.root.visible = state.visible;
  cub.root.position.set(state.x, 0, CUB_LANE_Z);
  cub.update(time, state.phase, state.run, state.stride);
  poseSharedGlance(adult, cub, sharedGlance(time));
  bird.update(time, adult);
  adult.followBird(time, bird.root.position);
  world.update(time);
  scene.updateMatrixWorld(true);
}
function visibleSnapshot() {
  const values = [];
  scene.traverseVisible((object) => {
    values.push(...object.matrixWorld.elements);
    if (object.isInstancedMesh) values.push(...object.instanceMatrix.array);
  });
  return values;
}

test('the bird perches for exactly five seconds', () => {
  assert.equal(birdState(7.999).mode, 'arriving');
  assert.equal(birdState(8).mode, 'perched');
  assert.equal(birdState(12.999).mode, 'perched');
  assert.equal(birdState(13).mode, 'leaving');
});

function headAngles(bear) {
  const restInverse = asset.getObjectByName('Head').getWorldQuaternion(new THREE.Quaternion()).invert();
  const rotation = bear.body.getWorldQuaternion(new THREE.Quaternion()).invert()
    .multiply(bear.head.getWorldQuaternion(new THREE.Quaternion())).multiply(restInverse).normalize();
  return new THREE.Euler().setFromQuaternion(rotation, 'YZX');
}

test('the adult tilts up at 55% with a slight right turn and lean when the bird lands', () => {
  near(birdHeadMotion(8).weight, 0);
  near(birdHeadMotion(8.3).weight, 0.5);
  near(birdHeadMotion(8.6).weight, 1);
  near(birdHeadMotion(13).weight, 1);
  near(birdHeadMotion(13).tracking, 0);
  near(birdHeadMotion(17).weight, 0);
  // Sample where the walking head bob is zero to measure the tilt range exactly.
  const phase = 4 - 0.6 / (Math.PI * 2);
  adult.update(0, phase);
  const neutralPitch = headAngles(adult).z;
  adult.glance(1);
  const fullGlancePitch = Math.abs(headAngles(adult).z - neutralPitch);
  pose(phase * WALK_PERIOD);
  const angles = headAngles(adult);
  const birdPitch = angles.z - neutralPitch;
  assert.ok(birdPitch > 0, 'The head should tilt up toward the perched bird');
  near(birdPitch / fullGlancePitch, 0.55, 1e-6);
  assert.ok(angles.y < -0.12 && angles.y > -0.16, 'The landing turn is gently to his right');
  assert.ok(angles.x > 0.04 && angles.x < 0.06, 'A small right lean softens the straight lift');
  for (const time of [7.9, 8, 8.3, 8.6, 10, 13, 13.3, 13.6, 14]) {
    const state = cubState(time);
    cub.update(time, state.phase, state.run, state.stride);
    const cubHead = cub.head.quaternion.clone().normalize();
    cub.update(0, state.phase, state.run, state.stride);
    near(cubHead.angleTo(cub.head.quaternion.clone().normalize()), 0, 1e-7);
  }
  adult.update(17, phase);
  adult.followBird(17, bird.root.position);
  near(headAngles(adult).z, neutralPitch, 1e-7);
  for (const time of [8, 8.6, 13, 14.8, 15.5, 17]) {
    pose(time - 1e-5);
    const before = adult.head.quaternion.clone().normalize();
    pose(time + 1e-5);
    near(before.angleTo(adult.head.quaternion.clone().normalize()), 0, 1e-4);
  }
});

test('the adult follows the bird flight with bounded, smooth motion and returns forward', () => {
  const gaze = new THREE.Vector3();
  const target = new THREE.Vector3();
  const eye = new THREE.Vector3();
  let previous;
  let crossedTowardFlight = false;
  for (let time = 13; time <= 17; time += 1 / 120) {
    pose(time);
    const angles = headAngles(adult);
    assert.ok(Math.abs(angles.y) < 0.15 && Math.abs(angles.x) < 0.06);
    assert.ok(angles.z < 1.22 && angles.z > 0.92, 'Following should remain a small head movement');
    if (time > 15 && angles.y > 0.02) crossedTowardFlight = true;
    const current = adult.head.getWorldQuaternion(new THREE.Quaternion()).normalize();
    if (previous) assert.ok(previous.angleTo(current) * 120 < 0.65, 'No abrupt tracking turns');
    previous = current;
    if (time > 15 && time < 16) {
      adult.getGazePoint(eye);
      target.copy(bird.root.position).sub(eye).normalize();
      const following = adult.getGazeDirection(gaze).dot(target);
      adult.update(0, time / WALK_PERIOD);
      assert.ok(following > adult.getGazeDirection(gaze).dot(target), 'The tilt should bring the gaze toward the departing bird');
    }
  }
  assert.ok(crossedTowardFlight, 'The head should follow across toward the flight path');
  pose(17);
  const returned = adult.head.quaternion.clone().normalize();
  adult.update(0, 17 / WALK_PERIOD);
  near(returned.angleTo(adult.head.quaternion.clone().normalize()), 0, 1e-7);
  pose(15.6);
  const reference = visibleSnapshot();
  for (const time of [28, 8, 17, 0, 15.6]) pose(time);
  assert.deepEqual(visibleSnapshot(), reference);
});

test('the cub walks beside the adult until departing at 27 seconds, with smooth velocity joins', () => {
  for (let t = 23; t <= 27; t += 0.125) {
    assert.equal(cubState(t).x, CUB_WALK_X);
    assert.equal(cubState(t).velocity, 0);
    assert.equal(cubState(t).run, 0);
  }
  near(cubState(23 - 1e-4).velocity, 0, 1e-7);
  near(cubState(27 + 1e-4).velocity, 0, 1e-7);
  assert.ok(cubState(27.01).x > CUB_WALK_X);
  assert.ok(cubState(29).velocity > cubState(28).velocity);
});

test('the adult pose and environment match at the loop seam', () => {
  pose(0);
  const start = visibleSnapshot();
  pose(LOOP_DURATION);
  const end = visibleSnapshot();
  assert.equal(start.length, end.length);
  end.forEach((value, i) => near(value, start[i], 1e-6));
  // Check just before the seam too; an endpoint-only check can hide a jump.
  pose(LOOP_DURATION - 1e-5);
  const before = visibleSnapshot();
  before.forEach((value, i) => near(value, start[i], 1e-3));
});

test('the cub turns at 22 seconds, the adult at 23, and they look ahead at 27 and 28', () => {
  const direction = new THREE.Vector3();
  for (let time = 0; time < WALK_PERIOD; time += 0.1) {
    pose(time);
    adult.getGazeDirection(direction);
    assert.ok(direction.x > 0.98 && Math.abs(direction.y) < 0.2);
  }
  assert.deepEqual(sharedGlance(22), { cub: 0, adult: 0 });
  near(sharedGlance(22.3).cub, 0.5);
  near(sharedGlance(22.3).adult, 0);
  assert.deepEqual(sharedGlance(23), { cub: 1, adult: 0 });
  near(sharedGlance(23.3).adult, 0.5);
  assert.deepEqual(sharedGlance(27), { cub: 1, adult: 1 });
  near(sharedGlance(27.3).cub, 0.5);
  near(sharedGlance(27.3).adult, 1);
  assert.deepEqual(sharedGlance(28), { cub: 0, adult: 1 });
  near(sharedGlance(28.3).adult, 0.5);
  assert.deepEqual(sharedGlance(28.6), { cub: 0, adult: 0 });
  // Once each turn finishes, its actual head returns to the ordinary gait pose.
  for (const [bear, time] of [[cub, 27.6], [adult, 28.6]]) {
    pose(time);
    const head = bear.head.quaternion.clone();
    const state = cubState(time);
    if (bear === cub) bear.update(time, state.phase, state.run, state.stride);
    else bear.update(time, time / WALK_PERIOD);
    near(head.angleTo(bear.head.quaternion), 0, 1e-7);
  }
});

test('both heads stay within the reduced tilt limits, including while the cub departs', () => {
  const limits = {
    adult: { forwardLift: 0.95, maxPitch: 20, minPitch: 18, maxYaw: 42, minYaw: 40 },
    cub: { forwardLift: 0.42, maxPitch: 42, minPitch: 40, maxYaw: 49, minYaw: 47 },
  };
  const heldPoses = new Map();
  const restInverse = asset.getObjectByName('Head').getWorldQuaternion(new THREE.Quaternion()).invert();
  for (let time = 21; time < 31; time += 0.025) {
    pose(time);
    const weights = sharedGlance(time);
    for (const bear of [adult, cub]) {
      const limit = limits[bear.root.name];
      const relative = bear.body.getWorldQuaternion(new THREE.Quaternion()).invert()
        .multiply(bear.head.getWorldQuaternion(new THREE.Quaternion()));
      const matrix = new THREE.Matrix4().makeRotationFromQuaternion(relative.clone().multiply(restInverse)).elements;
      const lift = Math.atan2(matrix[1], matrix[5]);
      const yaw = Math.atan2(matrix[8], matrix[10]);
      const pitchDegrees = THREE.MathUtils.radToDeg(Math.abs(lift - limit.forwardLift));
      const yawDegrees = THREE.MathUtils.radToDeg(Math.abs(yaw));
      assert.ok(yawDegrees <= limit.maxYaw);
      assert.ok(pitchDegrees <= limit.maxPitch);
      if (weights[bear.root.name] === 1) {
        assert.ok(yawDegrees >= limit.minYaw && pitchDegrees >= limit.minPitch);
        if (!heldPoses.has(bear)) heldPoses.set(bear, relative.clone().normalize());
        near(relative.normalize().angleTo(heldPoses.get(bear)), 0, 1e-6);
      }
    }
  }
  for (const time of [22, 22.6, 23, 23.6, 27, 27.6, 28, 28.6]) {
    pose(time - 1e-5);
    const before = [adult.head.quaternion.clone().normalize(), cub.head.quaternion.clone().normalize()];
    pose(time + 1e-5);
    [adult, cub].forEach((bear, i) => near(before[i].angleTo(bear.head.quaternion.clone().normalize()), 0, 1e-4));
  }
});

test('the cub has bounded running cadence and continuous speed and leg phase', () => {
  for (let time = CUB_ENTER + 0.01; time < CUB_EXIT; time += 0.025) {
    const state = cubState(time);
    const next = cubState(time + 0.001);
    assert.ok(state.velocity >= 0 && state.velocity <= 3.1);
    assert.ok(state.cadence > 0 && state.cadence < 2.3);
    near(state.stride * CUB_SCALE * state.cadence, GROUND_SPEED + state.velocity);
    near((next.phase - state.phase) / 0.001, state.cadence, 0.02);
  }
  for (const time of [20.5, 23, 27, 29]) {
    const before = cubState(time - 1e-5);
    const after = cubState(time + 1e-5);
    near(before.x, after.x, 1e-4);
    near(before.velocity, after.velocity, 1e-7);
    near(before.phase, after.phase, 1e-4);
    near(before.stride, after.stride, 1e-7);
  }
});

test('planted adult paws travel at the same speed as the ground', () => {
  const dt = 1e-4;
  const start = footCycle(0.2, GROUND_SPEED * WALK_PERIOD);
  const end = footCycle(0.2 + dt / WALK_PERIOD, GROUND_SPEED * WALK_PERIOD);
  near((end.x - start.x) / dt, -GROUND_SPEED);
  assert.equal(start.y, 0);
});

test('foot recovery is continuous at lift-off, touchdown, and phase wrap', () => {
  for (const run of [0, 0.5, 1]) {
    const stance = 0.64 + (0.30 - 0.64) * run;
    for (const boundary of [stance, 1]) {
      const before = footCycle(boundary - 1e-7, 1.2, run);
      const after = footCycle(boundary + 1e-7, 1.2, run);
      near(before.x, after.x, 1e-5);
      near(before.y, after.y, 1e-5);
    }
  }
});

test('bird landing and takeoff are continuous, and the perch follows the body', () => {
  for (const boundary of [8, 13]) {
    pose(boundary - 1e-6);
    const before = bird.root.position.clone();
    pose(boundary + 1e-6);
    assert.ok(before.distanceTo(bird.root.position) < 1e-5);
  }
  for (const t of [8, 9.1, 10.8, 12.9]) {
    pose(t);
    const local = adult.perch.worldToLocal(bird.root.position.clone());
    near(local.x, 0);
    near(local.y, 0);
    near(local.z, 0);
  }
});

test('the imported model has a complete skeleton and normalized skin weights', () => {
  assert.ok(bytes.byteLength < 400_000, 'The optimized GLB should remain small');
  assert.ok(adult.skinnedMeshes.length > 0);
  let triangles = 0;
  for (const mesh of adult.skinnedMeshes) {
    assert.equal(mesh.skeleton.bones.length, 16);
    const { skinWeight, skinIndex } = mesh.geometry.attributes;
    triangles += mesh.geometry.index.count / 3;
    for (let i = 0; i < skinWeight.count; i++) {
      let sum = 0;
      for (let j = 0; j < 4; j++) {
        const weight = skinWeight.getComponent(i, j);
        sum += weight;
        assert.ok(weight >= 0 && weight <= 1);
        assert.ok(skinIndex.getComponent(i, j) < mesh.skeleton.bones.length);
      }
      near(sum, 1, 1e-6);
    }
  }
  assert.ok(triangles >= 9000 && triangles <= 11000);
});

test('adult and cub share the model geometry but animate independent skeletons', () => {
  const adultMesh = adult.skinnedMeshes[0];
  const cubMesh = cub.skinnedMeshes[0];
  assert.equal(adultMesh.geometry, cubMesh.geometry);
  assert.notEqual(adultMesh.skeleton, cubMesh.skeleton);
  adult.update(0.5, 0.2);
  const before = [...adultMesh.skeleton.boneMatrices];
  cub.update(0.5, 0.8, 1, 0.82 / 0.48);
  assert.deepEqual([...adultMesh.skeleton.boneMatrices], before);
  assert.notDeepEqual([...cubMesh.skeleton.boneMatrices], before);
});

test('the new rig plants its paws at the requested height and ground speed', () => {
  const position = new THREE.Vector3();
  for (let phase = 0; phase < 1; phase += 1 / 32) {
    adult.update(phase * WALK_PERIOD, phase);
    for (const leg of adult.legs) {
      const step = footCycle(phase + leg.phase, GROUND_SPEED * WALK_PERIOD);
      if (step.y === 0) {
        leg.paw.getWorldPosition(position);
        near(position.y, leg.ankleRest.y + 0.002, 2e-5);
        near(position.x, adult.root.position.x + leg.ankleRest.x + step.x, 2e-5);
      }
    }
  }
  const leg = adult.legs[0];
  adult.update(0.5, 0.2);
  const start = leg.paw.getWorldPosition(new THREE.Vector3());
  adult.update(0.5001, 0.2 + 0.0001 / WALK_PERIOD);
  leg.paw.getWorldPosition(position);
  near((position.x - start.x) / 0.0001, -GROUND_SPEED, 1e-4);
});

test('skin vertices deform with the legs and remain above the ice', () => {
  const mesh = adult.skinnedMeshes[0];
  const positions = mesh.geometry.attributes.position;
  const vertex = new THREE.Vector3();
  let toe = -1;
  for (let i = 0; i < positions.count; i++) {
    if (positions.getY(i) < 0.1 && positions.getX(i) > 0.7 && positions.getZ(i) > 0.1) { toe = i; break; }
  }
  assert.ok(toe >= 0);
  adult.update(0, 0);
  const before = mesh.applyBoneTransform(toe, new THREE.Vector3().fromBufferAttribute(positions, toe));
  adult.update(1.25, 0.5);
  const after = mesh.applyBoneTransform(toe, new THREE.Vector3().fromBufferAttribute(positions, toe));
  assert.ok(before.distanceTo(after) > 0.4, 'The supplied surface must deform, not just translate as a rigid model');
  for (let phase = 0; phase < 1; phase += 1 / 16) {
    adult.update(phase * WALK_PERIOD, phase);
    let lowest = Infinity;
    for (let i = 0; i < positions.count; i++) {
      vertex.fromBufferAttribute(positions, i);
      mesh.applyBoneTransform(i, vertex);
      assert.ok(vertex.toArray().every(Number.isFinite));
      lowest = Math.min(lowest, vertex.y);
    }
    assert.ok(lowest > -0.015 && lowest < 0.025, `Unexpected ground contact: ${lowest}`);
  }
});

test('the print model has no fused surface bridging the independently animated paws', () => {
  const geometry = adult.skinnedMeshes[0].geometry;
  const position = geometry.attributes.position;
  for (let i = 0; i < geometry.index.count; i += 3) {
    const vertices = [0, 1, 2].map((offset) => geometry.index.getX(i + offset));
    if (vertices.every((index) => position.getY(index) < 0.6)) {
      const lateral = vertices.map((index) => position.getZ(index));
      assert.ok(!(Math.min(...lateral) < -0.005 && Math.max(...lateral) > 0.005),
        'A triangle joins opposite paws and would stretch when they separate');
    }
  }
});

test('the bird socket stays on the deformed back surface throughout a walk', () => {
  const ray = new THREE.Raycaster();
  const socket = new THREE.Vector3();
  for (let phase = 0; phase < 1; phase += 1 / 8) {
    adult.update(phase * WALK_PERIOD, phase);
    adult.perch.getWorldPosition(socket);
    ray.set(socket.clone().add(new THREE.Vector3(0, 1, 0)), new THREE.Vector3(0, -1, 0));
    const hit = ray.intersectObjects(adult.skinnedMeshes, false)[0];
    assert.ok(hit, 'The socket must be above the bear surface');
    near(socket.y - hit.point.y, 0.006, 0.002);
  }
});

test('entrance and exit visibility changes occur beyond the widest camera frame', () => {
  assert.ok(cubState(CUB_ENTER).x < -15);
  assert.ok(cubState(CUB_EXIT - 1e-6).x > 15);
  pose(4);
  assert.ok(bird.root.position.x < -15);
  pose(17 - 1e-6);
  assert.ok(bird.root.position.x > 15);
  assert.equal(cubState(39.9).visible, false);
  assert.equal(birdState(39.9).mode, 'hidden');
});

test('repeated playback and out-of-order seeking produce finite, deterministic transforms', () => {
  pose(28.25);
  const reference = visibleSnapshot();
  for (let time = 0; time < 120; time += 1 / 30) {
    pose(time % LOOP_DURATION);
    scene.traverseVisible((object) => assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
  }
  pose(28.25);
  assert.deepEqual(visibleSnapshot(), reference);
});
