# NORTE — Um passeio...

A 40-second looping Arctic scene made with Three.js. A polar bear walks beneath a passing bird, then shares the path with a cub. The bears use a rigged GLB built from `Bear.stl`; the bird and landscape are procedural.

## Run

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Use the on-screen controls to play, pause, restart, or scrub the animation. In development, `/?time=8.6` opens a paused pose at a specific second.

```sh
npm test
npm run build
npm run preview
```

The production build is written to `dist/`. Colors use the [Nord palette](https://www.nordtheme.com/docs/colors-and-palettes/).

## Bear model

`public/models/bear.glb` is the web model; `assets/bear-rig.blend` is its editable Blender source. To rebuild them from the original STL:

```sh
blender --background --factory-startup --python tools/build_bear.py -- --source /path/to/Bear.stl
```

The original STL is not included. The build script preserves independently animated legs, head, and the bird's perch point.
