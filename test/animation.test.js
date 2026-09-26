import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createBear } from '../src/bear.js';
import { createBird } from '../src/bird.js';
import { createWorld } from '../src/world.js';
import { birdState, cubState, footCycle, GROUND_SPEED, LOOP_DURATION, WALK_PERIOD } from '../src/timeline.js';

const near = (actual, expected, tolerance = 1e-8) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} != ${expected}`);
const scene = new THREE.Scene();
const adult = createBear();
const cub = createBear({ scale: 0.48, cub: true });
const bird = createBird();
const world = createWorld(scene);
scene.add(adult.root, cub.root, bird.root);

function pose(time) {
  adult.update(time, time / WALK_PERIOD);
  const state = cubState(time);
  cub.root.visible = state.visible;
  cub.root.position.set(state.x, 0, 1.3);
  cub.update(time, state.phase, state.run, 0.82 / 0.48);
  bird.update(time, adult);
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

test('the cub walks beside the adult for seven seconds, with smooth velocity joins', () => {
  for (let t = 23; t <= 30; t += 0.125) {
    assert.equal(cubState(t).x, -1.2);
    assert.equal(cubState(t).velocity, 0);
    assert.equal(cubState(t).run, 0);
  }
  near(cubState(23 - 1e-4).velocity, 0, 1e-7);
  near(cubState(30 + 1e-4).velocity, 0, 1e-7);
  assert.ok(cubState(32).velocity > cubState(31).velocity);
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

test('planted adult paws travel at the same speed as the ground', () => {
  const dt = 1e-4;
  const start = footCycle(0.2, GROUND_SPEED * WALK_PERIOD);
  const end = footCycle(0.2 + dt / WALK_PERIOD, GROUND_SPEED * WALK_PERIOD);
  near((end.x - start.x) / dt, -GROUND_SPEED);
  assert.equal(start.y, 0);
});

test('foot recovery is continuous at lift-off, touchdown, and phase wrap', () => {
  for (const run of [0, 0.5, 1]) {
    const stance = 0.64 + (0.38 - 0.64) * run;
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
    const local = adult.body.worldToLocal(bird.root.position.clone());
    near(local.x, -0.42);
    near(local.y, 2.947);
    near(local.z, 0.13);
  }
});

test('entrance and exit visibility changes occur beyond the widest camera frame', () => {
  assert.ok(cubState(18).x < -15);
  assert.ok(cubState(36 - 1e-6).x > 15);
  pose(4);
  assert.ok(bird.root.position.x < -15);
  pose(17 - 1e-6);
  assert.ok(bird.root.position.x > 15);
  assert.equal(cubState(39.9).visible, false);
  assert.equal(birdState(39.9).mode, 'hidden');
});

test('repeated playback and out-of-order seeking produce finite, deterministic transforms', () => {
  pose(26.25);
  const reference = visibleSnapshot();
  for (let time = 0; time < 120; time += 1 / 30) {
    pose(time % LOOP_DURATION);
    scene.traverseVisible((object) => assert.ok(object.matrixWorld.elements.every(Number.isFinite)));
  }
  pose(26.25);
  assert.deepEqual(visibleSnapshot(), reference);
});
