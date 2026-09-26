export const LOOP_DURATION = 40;
export const WALK_PERIOD = 2.5;
export const GROUND_SPEED = 0.48;
export const GROUND_REPEAT = LOOP_DURATION * GROUND_SPEED;
export const TAU = Math.PI * 2;
export const clamp = (x, min = 0, max = 1) => Math.max(min, Math.min(max, x));
export const mix = (a, b, t) => a + (b - a) * t;
export const mod = (x, n) => ((x % n) + n) % n;
export const smooth = (x) => { const t = clamp(x); return t * t * (3 - 2 * t); };
export const smoother = (x) => { const t = clamp(x); return t ** 3 * (t * (t * 6 - 15) + 10); };

export function hermite(a, b, velocityA, velocityB, t, duration) {
  return (2 * t ** 3 - 3 * t ** 2 + 1) * a
    + (t ** 3 - 2 * t ** 2 + t) * velocityA * duration
    + (-2 * t ** 3 + 3 * t ** 2) * b
    + (t ** 3 - t ** 2) * velocityB * duration;
}

export function cubState(time) {
  const t = mod(time, LOOP_DURATION);
  let x = -18;
  let velocity = 0;
  if (t >= 18 && t < 23) {
    const u = (t - 18) / 5;
    // Cubic deceleration: zero acceleration and velocity at the walking join.
    x = -1.2 - 16.8 * (1 - u) ** 3;
    velocity = 10.08 * (1 - u) ** 2;
  } else if (t >= 23 && t < 30) {
    x = -1.2;
  } else if (t >= 30) {
    const u = t - 30;
    x = -1.2 + 0.12 * u ** 3;
    velocity = 0.36 * u ** 2;
  }
  return {
    visible: t >= 18 && t < 36,
    x,
    velocity,
    run: smooth((velocity - 0.08) / 1.5),
    // Distance drives the feet, so the gait slows continuously with the cub.
    phase: (GROUND_SPEED * t + x) / 0.82,
  };
}

export function birdState(time) {
  const t = mod(time, LOOP_DURATION);
  if (t < 4 || t >= 17) return { mode: 'hidden', progress: 0 };
  if (t < 8) return { mode: 'arriving', progress: (t - 4) / 4 };
  if (t < 13) return { mode: 'perched', progress: (t - 8) / 5 };
  return { mode: 'leaving', progress: (t - 13) / 4 };
}

export function chapterAt(time) {
  const t = mod(time, LOOP_DURATION);
  if (t < 4 || t >= 36) return 'The long way home';
  if (t < 17) return 'A passing visitor';
  if (t < 23) return 'Little footsteps';
  if (t < 30) return 'Better together';
  return 'A little further';
}

// Constant backward velocity during stance; a lifted, eased recovery step.
export function footCycle(phase, stride, run = 0) {
  const p = mod(phase, 1);
  const stance = mix(0.64, 0.38, run);
  const reach = stride * stance / 2;
  if (p < stance) return { x: reach - stride * p, y: 0 };
  const u = (p - stance) / (1 - stance);
  return {
    x: hermite(-reach, reach, -stride, -stride, u, 1 - stance),
    y: Math.sin(Math.PI * u) ** 2 * mix(0.24, 0.62, run),
  };
}
