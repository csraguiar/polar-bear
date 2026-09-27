import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { BIRD_TILT_STRENGTH, birdHeadMotion, clamp, footCycle, mix, TAU } from './timeline.js';

// Halve both the sideways turn and pitch change from the forward walking pose.
// Fixed endpoints prevent either head turning farther as the cub moves away.
const GLANCE_POSES = {
  adult: { lift: 0.6133455203, yaw: -0.7249639231 },
  cub: { lift: 1.1375561304, yaw: 0.8394132139 },
};

export function poseSharedGlance(adult, cub, weights) {
  adult.glance(weights.adult);
  cub.glance(weights.cub);
}

export async function loadBearAsset(url) {
  const { scene } = await new GLTFLoader().loadAsync(url);
  return scene;
}

/** Each bear owns a skeleton; geometry and materials are shared between clones. */
export function createBear(asset, { scale = 1, cub = false } = {}) {
  if (!asset) throw new Error('A loaded bear GLB is required');
  const root = new THREE.Group();
  root.name = cub ? 'cub' : 'adult';
  const model = clone(asset);
  root.add(model);
  const body = model.getObjectByName('Root');
  const head = model.getObjectByName('Head');
  const neck = model.getObjectByName('Neck');
  const perch = model.getObjectByName('Perch');
  const eyeLeft = model.getObjectByName('Eye_L');
  const eyeRight = model.getObjectByName('Eye_R');
  const nose = model.getObjectByName('Nose');
  if (!body || !head || !neck || !perch) throw new Error('The bear asset is missing required rig nodes');
  root.updateMatrixWorld(true);
  const restNeckOrientation = neck.getWorldQuaternion(new THREE.Quaternion());
  const restHeadOrientation = head.getWorldQuaternion(new THREE.Quaternion());

  const rest = new Map();
  const skinnedMeshes = [];
  model.traverse((object) => {
    if (object.isBone) rest.set(object, {
      position: object.position.clone(), quaternion: object.quaternion.clone(),
    });
    if (object.isMesh) {
      object.castShadow = true;
      object.receiveShadow = true;
      // A static rest-pose bound can incorrectly cull an animated paw or head.
      object.frustumCulled = false;
    }
    if (object.isSkinnedMesh) skinnedMeshes.push(object);
  });

  const legs = [];
  for (const side of ['L', 'R']) {
    for (const kind of ['Front', 'Hind']) {
      const upper = model.getObjectByName(`${kind}Upper_${side}`);
      const lower = model.getObjectByName(`${kind}Lower_${side}`);
      const paw = model.getObjectByName(`${kind}Paw_${side}`);
      if (!upper || !lower || !paw) throw new Error(`Missing ${kind} ${side} leg bones`);
      const front = kind === 'Front';
      legs.push({
        upper, lower, paw, front, side,
        upperLength: lower.position.length(), lowerLength: paw.position.length(),
        upperAxis: lower.position.clone().normalize().applyQuaternion(upper.quaternion),
        lowerAxis: paw.position.clone().normalize().applyQuaternion(lower.quaternion),
        ankleRest: paw.getWorldPosition(new THREE.Vector3()),
        pawRestQuaternion: paw.getWorldQuaternion(new THREE.Quaternion()),
        phase: (front ? 0 : 0.73) + (side === 'R' ? 0.5 : 0),
      });
    }
  }
  root.scale.setScalar(scale);

  // Reused scratch space: no vectors or quaternions allocated inside the gait.
  const modelInverse = new THREE.Matrix4();
  const rootRotation = new THREE.Quaternion();
  const parentInverse = new THREE.Quaternion();
  const desiredRotation = new THREE.Quaternion();
  const swing = new THREE.Quaternion();
  const tilt = new THREE.Quaternion();
  const hip = new THREE.Vector3();
  const knee = new THREE.Vector3();
  const ankle = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const pole = new THREE.Vector3();
  const aim = new THREE.Vector3();
  const zAxis = new THREE.Vector3(0, 0, 1);
  const yAxis = new THREE.Vector3(0, 1, 0);
  const xAxis = new THREE.Vector3(1, 0, 0);
  const bodyOrientation = new THREE.Quaternion();
  const yawRotation = new THREE.Quaternion();
  const pitchRotation = new THREE.Quaternion();
  const rollRotation = new THREE.Quaternion();
  const gazePosition = new THREE.Vector3();
  const otherEye = new THREE.Vector3();
  const birdDirection = new THREE.Vector3();
  const forwardLift = cub ? 0.42 : 0.95;
  let baseLift = forwardLift;
  const glancePose = GLANCE_POSES[cub ? 'cub' : 'adult'];

  function getGazePoint(target) {
    eyeLeft.getWorldPosition(target);
    eyeRight.getWorldPosition(otherEye);
    return target.add(otherEye).multiplyScalar(0.5);
  }

  function getGazeDirection(target) {
    getGazePoint(gazePosition);
    nose.getWorldPosition(target);
    return target.sub(gazePosition).normalize();
  }

  function orientBone(bone, orientation) {
    bone.parent.getWorldQuaternion(parentInverse).invert();
    bone.quaternion.copy(parentInverse).multiply(orientation);
    bone.updateWorldMatrix(false, true);
  }

  function applyHeadPose(lift, yaw, roll = 0) {
    body.getWorldQuaternion(bodyOrientation);
    yawRotation.setFromAxisAngle(yAxis, yaw * 0.65);
    pitchRotation.setFromAxisAngle(zAxis, lift * 0.6);
    rollRotation.setFromAxisAngle(xAxis, roll * 0.4);
    desiredRotation.copy(bodyOrientation).multiply(yawRotation).multiply(pitchRotation).multiply(rollRotation).multiply(restNeckOrientation);
    orientBone(neck, desiredRotation);
    yawRotation.setFromAxisAngle(yAxis, yaw);
    pitchRotation.setFromAxisAngle(zAxis, lift);
    rollRotation.setFromAxisAngle(xAxis, roll);
    desiredRotation.copy(bodyOrientation).multiply(yawRotation).multiply(pitchRotation).multiply(rollRotation).multiply(restHeadOrientation);
    orientBone(head, desiredRotation);
  }

  function glance(weight) {
    const amount = clamp(weight);
    applyHeadPose(mix(baseLift, glancePose.lift, amount), glancePose.yaw * amount);
    for (const mesh of skinnedMeshes) mesh.skeleton.update();
  }

  function followBird(time, position) {
    if (cub) return;
    const { weight, tracking } = birdHeadMotion(time);
    if (weight <= 0) return;
    // Begin from this frame's walking pose, keeping seeking deterministic.
    applyHeadPose(baseLift, 0);
    getGazePoint(gazePosition);
    body.getWorldQuaternion(bodyOrientation).invert();
    birdDirection.copy(position).sub(gazePosition).applyQuaternion(bodyOrientation);
    // Limit tracking to a small fraction of the bird's actual direction.
    // A forward floor avoids a sudden left/right flip while it is behind him.
    const followYaw = clamp(Math.atan2(-birdDirection.z, Math.max(0.75, birdDirection.x)) * 0.35, -0.14, 0.14);
    const followPitch = clamp(Math.atan2(birdDirection.y, Math.hypot(birdDirection.x, birdDirection.z)) * 0.35, 0, 0.24);
    const landingPitch = Math.abs(forwardLift - glancePose.lift) * BIRD_TILT_STRENGTH;
    // Facing +X, a negative yaw and positive roll turn/lean to the bear's right.
    applyHeadPose(baseLift + mix(landingPitch, followPitch, tracking) * weight,
      mix(-0.14, followYaw, tracking) * weight,
      0.05 * (1 - tracking) * weight);
    for (const mesh of skinnedMeshes) mesh.skeleton.update();
  }

  function pointBone(bone, restAxis, targetDirection) {
    bone.parent.getWorldQuaternion(parentInverse).invert();
    aim.copy(targetDirection).normalize().applyQuaternion(rootRotation).applyQuaternion(parentInverse);
    swing.setFromUnitVectors(restAxis, aim);
    bone.quaternion.copy(swing).multiply(rest.get(bone).quaternion);
    bone.updateWorldMatrix(false, true);
  }

  function update(time, phase, run = 0, stride = 1.2) {
    for (const [bone, transform] of rest) {
      bone.position.copy(transform.position);
      bone.quaternion.copy(transform.quaternion);
    }
    const angle = phase * TAU;
    // One restrained rise per running stride, timed between the hind push and
    // forepaw landing. The lower running posture leaves room to extend the legs.
    const bounce = mix(0.022 * Math.cos(angle * 2), 0.05 * Math.sin(angle - 0.4), run);
    body.position.y -= mix(0.05, 0.10, run);
    body.position.y += bounce;
    body.rotation.z = Math.sin(angle) * mix(0.011, 0.035, run);
    body.rotation.x = Math.sin(angle) * 0.012 * (1 - run);
    root.updateWorldMatrix(true, true);
    baseLift = forwardLift + Math.sin(angle + 0.6) * mix(0.018, 0.009, run);
    applyHeadPose(baseLift, 0);
    modelInverse.copy(root.matrixWorld).invert();
    root.getWorldQuaternion(rootRotation);

    for (const leg of legs) {
      const offset = mix(leg.phase, (leg.front ? 0.04 : 0.54) + (leg.side === 'R' ? 0.12 : 0), run);
      const step = footCycle(phase + offset, stride, run);
      leg.upper.getWorldPosition(hip).applyMatrix4(modelInverse);
      ankle.copy(leg.ankleRest);
      ankle.x += step.x;
      ankle.y += step.y + 0.002;
      direction.subVectors(ankle, hip);
      const distance = Math.min(direction.length(), leg.upperLength + leg.lowerLength - 0.001);
      direction.normalize();
      // Preserve the anatomical elbow/knee bend, rather than arbitrarily
      // flipping the IK solution when a foot passes beneath its hip.
      pole.set(leg.front ? -1 : 1, 0, 0);
      pole.addScaledVector(direction, -pole.dot(direction)).normalize();
      const along = (leg.upperLength ** 2 - leg.lowerLength ** 2 + distance ** 2) / (2 * distance);
      const bend = Math.sqrt(Math.max(0, leg.upperLength ** 2 - along ** 2));
      knee.copy(hip).addScaledVector(direction, along).addScaledVector(pole, bend);
      ankle.copy(hip).addScaledVector(direction, distance);
      pointBone(leg.upper, leg.upperAxis, aim.subVectors(knee, hip));
      pointBone(leg.lower, leg.lowerAxis, aim.subVectors(ankle, knee));

      // Counter-rotate the paws to keep their original sole angle on the ice.
      leg.paw.parent.getWorldQuaternion(parentInverse).invert();
      tilt.setFromAxisAngle(zAxis, -step.y * 0.2);
      desiredRotation.copy(rootRotation).multiply(tilt).multiply(leg.pawRestQuaternion);
      leg.paw.quaternion.copy(parentInverse).multiply(desiredRotation);
      leg.paw.updateWorldMatrix(false, true);
    }
    root.updateWorldMatrix(true);
    for (const mesh of skinnedMeshes) mesh.skeleton.update();
  }

  function dispose() {
    // Geometry/material ownership stays with the scene's shared resource cleanup.
    for (const skeleton of new Set(skinnedMeshes.map((mesh) => mesh.skeleton))) skeleton.dispose();
  }
  return { root, body, head, perch, legs, skinnedMeshes, update, glance, followBird, getGazePoint, getGazeDirection, dispose };
}
