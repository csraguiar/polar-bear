export const LOOP_DURATION = 40;
export const WALK_PERIOD = 2.5;
export const GROUND_SPEED = 0.48;
export const GROUND_REPEAT = LOOP_DURATION * GROUND_SPEED;
export const CUB_SCALE = 0.48;
export const CUB_WALK_X = 0.4;
export const CUB_LANE_Z = 1.7;
export const CUB_ENTER = 16;
export const CUB_DEPART = 27;
export const CUB_EXIT = 34;
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

function cubMotion(t) {
  const startX = -16;
  const slowAt = 20.5;
  const slowDuration = 23 - slowAt;
  const arrivalSpeed = (CUB_WALK_X - startX) / (slowAt - CUB_ENTER + slowDuration / 2);
  let x = startX;
  let velocity = 0;
  if (t >= CUB_ENTER && t < slowAt) {
    velocity = arrivalSpeed;
    x = startX + arrivalSpeed * (t - CUB_ENTER);
  } else if (t >= slowAt && t < 23) {
    const u = (t - slowAt) / slowDuration;
    // Integrating smooth velocity gives continuous position AND acceleration.
    velocity = arrivalSpeed * (1 - smooth(u));
    x = startX + arrivalSpeed * (slowAt - CUB_ENTER)
      + arrivalSpeed * slowDuration * (u - u ** 3 + u ** 4 / 2);
  } else if (t >= 23 && t < CUB_DEPART) {
    x = CUB_WALK_X;
  } else if (t >= CUB_DEPART) {
    const duration = 2;
    const speed = 3.1;
    const u = clamp((t - CUB_DEPART) / duration);
    velocity = speed * smooth(u);
    x = CUB_WALK_X + speed * duration * (u ** 3 - u ** 4 / 2)
      + speed * Math.max(0, t - CUB_DEPART - duration);
  }
  const run = smooth((velocity - 0.12) / 1.8);
  const worldStride = mix(0.82, 1.6, run);
  return { x, velocity, run, stride: worldStride / CUB_SCALE, cadence: (GROUND_SPEED + velocity) / worldStride };
}

// Integrate cadence once, at a fixed sampling rate. Poses remain deterministic
// when scrubbing; changing stride length cannot reset or reverse the leg phase.
const GAIT_SAMPLES_PER_SECOND = 240;
const cubPhases = new Float64Array(LOOP_DURATION * GAIT_SAMPLES_PER_SECOND + 1);
let lastCadence = cubMotion(0).cadence;
for (let i = 1; i < cubPhases.length; i++) {
  const cadence = cubMotion(i / GAIT_SAMPLES_PER_SECOND).cadence;
  cubPhases[i] = cubPhases[i - 1] + (lastCadence + cadence) / (2 * GAIT_SAMPLES_PER_SECOND);
  lastCadence = cadence;
}

export function cubState(time) {
  const t = mod(time, LOOP_DURATION);
  const sample = t * GAIT_SAMPLES_PER_SECOND;
  const i = Math.floor(sample);
  return {
    ...cubMotion(t),
    visible: t >= CUB_ENTER && t < CUB_EXIT,
    phase: mix(cubPhases[i], cubPhases[i + 1], sample - i),
  };
}

export function sharedGlance(time) {
  const t = mod(time, LOOP_DURATION);
  // The cub initiates the glance and looks ahead as it starts to leave.
  // The adult responds one second later, then holds for one second longer.
  return {
    cub: smoother((t - 22) / 0.6) * (1 - smoother((t - CUB_DEPART) / 0.6)),
    adult: smoother((t - 23) / 0.6) * (1 - smoother((t - 28) / 0.6)),
  };
}

export const BIRD_TILT_STRENGTH = 0.55;

export function birdHeadMotion(time) {
  const t = mod(time, LOOP_DURATION);
  return {
    // Hold the landing pose, follow takeoff, then relax as the bird exits.
    weight: smoother((t - 8) / 0.6) * (1 - smoother((t - 15.5) / 1.5)),
    tracking: smoother((t - 13) / 1.8),
  };
}

export function birdState(time) {
  const t = mod(time, LOOP_DURATION);
  if (t < 4 || t >= 17) return { mode: 'hidden', progress: 0 };
  if (t < 8) return { mode: 'arriving', progress: (t - 4) / 4 };
  if (t < 13) return { mode: 'perched', progress: (t - 8) / 5 };
  return { mode: 'leaving', progress: (t - 13) / 4 };
}

// Constant backward velocity during stance; a lifted, eased recovery step.
export function footCycle(phase, stride, run = 0) {
  const p = mod(phase, 1);
  const stance = mix(0.64, 0.30, run);
  const reach = stride * stance / 2;
  if (p < stance) return { x: reach - stride * p, y: 0 };
  const u = (p - stance) / (1 - stance);
  return {
    x: hermite(-reach, reach, -stride, -stride, u, 1 - stance),
    y: Math.sin(Math.PI * u) ** 2 * mix(0.24, 0.40, run),
  };
}
