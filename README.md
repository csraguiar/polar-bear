# North — A quiet passage

A procedural Three.js short: an adult polar bear walks through a quiet Arctic
landscape, receives a visit from a bird, and shares part of the journey with a cub.
All animal geometry is generated locally; no models or textures are downloaded.
Colors come from [Nord](https://www.nordtheme.com/docs/colors-and-palettes/).

## Run

```sh
npm install
npm run dev
```

`npm run build` creates the production site in `dist/`.
`npm run preview` serves that build. `npm test` checks the timeline and animation.

## The 40-second loop

| Time | Action |
| --- | --- |
| 0–4 s | The adult walks alone. |
| 4–8 s | The bird arcs into frame and lands. |
| 8–13 s | The bird stays attached to the bear's back, with small idle movements. |
| 13–17 s | The bird takes off and leaves the frame. |
| 18–23 s | The cub runs in from behind and slows beside the adult. |
| 23–30 s | Both bears walk together for seven seconds. |
| 30–36 s | The cub accelerates and runs out of frame. |
| 36–40 s | The adult continues alone, returning to the initial pose. |

The adult completes 16 walk cycles per loop. The ground moves exactly one repeat
length in the same time. All poses are computed from timeline time, so seeking
and repeated playback do not accumulate animation state. The timeline advances
using elapsed frame time and stops advancing when the tab is hidden.

## Controls and accessibility

- Play/pause, restart, and a draggable timeline.
- Space toggles playback when a form control is not focused.
- Native slider keyboard controls work when the timeline has focus.
- Reduced-motion preferences start the scene paused.
- The camera adapts to the viewport; device pixel ratio is capped at two.
- WebGL context loss displays a fallback message and resumes after restoration.

## Source

- `src/timeline.js`: timings, easing, travel, and reusable foot cycles.
- `src/bear.js`: procedural anatomy and two-segment leg articulation.
- `src/bird.js`: bird geometry, wing motion, flight paths, and moving perch.
- `src/world.js`: Nord lighting, shadows, and repeating instanced ground details.
- `src/main.js`: renderer, camera, clock, controls, resize, and cleanup.
- `src/style.css`: responsive film framing and playback interface.

In development, `/?time=10` opens a paused pose at a specific second. A
development-only `window.__north` object exposes `seek(seconds)` and `play()` for
visual inspection. These hooks are excluded from the production build.

The interface uses Google Fonts with local serif/sans-serif fallbacks. The
animation itself has no external runtime asset dependency.
