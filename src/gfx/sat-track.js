import * as THREE from "three";
/* Line2 rather than THREE.Line: WebGL ignores linewidth on LineBasicMaterial
   and always draws one device pixel, which on a high-DPI screen is a hairline
   that reads as blurry. These build the line as camera-facing quads instead,
   so the width is real and controllable. */
import { Line2 } from "three/addons/lines/Line2.js";
import { LineGeometry } from "three/addons/lines/LineGeometry.js";
import { LineMaterial } from "three/addons/lines/LineMaterial.js";
import { EARTH_RADIUS_KM, TIME_SCALE } from "./sat-view.js";

/* Imported rather than fetched by path. These live under src/, so the bundler
   is the only thing that puts them in a build -- ?url emits the CSV as its own
   hashed asset and hands back the URL, which keeps 190KB of numbers out of the
   JS bundle while still surviving the build. The JSON is small enough to inline
   and is wanted synchronously, so it comes in whole. */
import trackUrl from "../daily-sat/data/sat.csv?url";
import meta from "../daily-sat/data/sat.json";

const SAT_COLOR = 0xff2d2d; // keep in step with --sat-color in style.css
const MARKER_RADIUS = 0.016; // Earth radii

/* How much of the orbit to draw either side of the satellite, in periods. Over
   1 on purpose: the trail laps itself, which closes the ring so the orbit reads
   as a complete path rather than an arc with two loose ends. The overlap is not
   exact -- the orbit precesses between laps -- so the two passes sit slightly
   apart and the ring gains a little depth from it. */
const TRAIL_PERIODS = 1.1;

// CSS pixels, honoured for real now that the line is quad-based.
const TRAIL_WIDTH = 2;

/** The satellite of the day: its track, a marker on it, and its name.

    Positions arrive as a flat table sampled every 30s, which is close enough
    together that straight lines between them are indistinguishable from the
    real arc at this scale -- so nothing here interpolates more cleverly than
    lerp. */
export class SatTrack {
  constructor({ label, caption } = {}) {
    this.label = label; // tracks the marker
    this.caption = caption; // parked in the corner
    this.meta = meta;
    this.points = null; // Float32Array, scene units, xyz per sample
    this.count = 0;
    this.seconds = 0;

    // Samples either side of the satellite. See TRAIL_PERIODS.
    this.half = Math.round(
      (meta.periodSeconds * TRAIL_PERIODS) / meta.stepSeconds,
    );

    this.group = new THREE.Group();
    this.marker = null;
    this.trail = null;

    // Scratch, reused every frame rather than reallocated.
    this.position = new THREE.Vector3();
    this.projected = new THREE.Vector3();
    this.toSat = new THREE.Vector3();
    this.toCentre = new THREE.Vector3();
  }

  /** Resolves once the track is parsed and the objects exist. A miss resolves
      anyway with nothing built: the globe is the point of the page and must not
      be held hostage to the satellite. */
  async load() {
    const text = await fetch(trackUrl)
      .then((r) => (r.ok ? r.text() : null))
      .catch(() => null);

    if (!text) return this;

    const rows = text.trim().split("\n").slice(1); // drop the header
    const points = new Float32Array(rows.length * 3);

    for (let i = 0; i < rows.length; i++) {
      // t is implied by the row index -- the pipeline emits a fixed step.
      const [, x, y, z] = rows[i].split(",");
      points[i * 3] = x / EARTH_RADIUS_KM;
      points[i * 3 + 1] = y / EARTH_RADIUS_KM;
      points[i * 3 + 2] = z / EARTH_RADIUS_KM;
    }

    this.points = points;
    this.count = rows.length;
    this.#build();

    return this;
  }

  #build() {
    const span = this.half * 2 + 1;

    /* Allocated once at the window's full width and rewritten in place each
       frame; only the draw range moves. Rebuilding the geometry every frame
       would churn a buffer upload per rendered frame for no gain. */
    this.window = new Float32Array(span * 3);

    const geometry = new LineGeometry();
    geometry.setPositions(this.window);

    /* resolution has to carry the drawable size: the shader works in screen
       space, and without it the width is computed against a default and comes
       out wrong. Kept up to date in setSize(). */
    this.material = new LineMaterial({
      color: SAT_COLOR,
      linewidth: TRAIL_WIDTH,
      resolution: new THREE.Vector2(1, 1),
      dashed: false,
    });

    this.trail = new Line2(geometry, this.material);
    // The window is rewritten from scratch every frame, so let three skip the
    // bounds it would otherwise recompute and get wrong.
    this.trail.frustumCulled = false;

    /* Basic, not standard: the marker should read as an indicator rather than
       as an object in the scene, so it ignores the sun and stays the same red
       on the night side as on the day side. */
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(MARKER_RADIUS, 16, 12),
      new THREE.MeshBasicMaterial({ color: SAT_COLOR }),
    );

    this.group.add(this.trail, this.marker);
  }

  /** Hangs the track off a viewer: adds it to that scene and takes over the
      per-frame tick. Also paints one frame immediately, so the label is placed
      even when the loop never runs (reduced motion renders a single frame). */
  attach(viewer) {
    if (!this.points) return this;

    viewer.scene.add(this.group);

    if (this.label) this.label.textContent = meta.name;

    if (this.caption) {
      this.caption.querySelector(".sat-caption-name").textContent = meta.name;
      this.caption.dataset.shown = "";
    }

    /* Starts from where the satellite actually is right now, then runs at the
       globe's own time scale. Beginning at the truth is what makes it the
       satellite of the day rather than an animation that happens to loop; the
       scale is what stops it sliding against a globe that spins 700x faster
       than the sky does. */
    const elapsed = (Date.now() - Date.parse(meta.startUtc)) / 1000;
    this.seconds = this.#wrap(elapsed);

    /* Its own listener rather than hooking the viewer's: viewer.onResize is a
       single handler, not a list, and wrapping it would leave the two silently
       coupled. */
    this.setSize(viewer.canvas);
    window.addEventListener("resize", () => this.setSize(viewer.canvas));

    this.#place(viewer.camera);
    viewer.tick = (delta) => {
      this.seconds = this.#wrap(this.seconds + delta * TIME_SCALE);
      this.#place(viewer.camera);
    };

    return this;
  }

  /** The line's width is computed in screen space, so it needs the drawable
      size and has to be told again whenever that changes. */
  setSize(canvas) {
    if (!this.material) return;
    this.material.resolution.set(
      canvas.clientWidth || window.innerWidth,
      canvas.clientHeight || window.innerHeight,
    );
  }

  #wrap(seconds) {
    const span = meta.windowSeconds;
    return ((seconds % span) + span) % span;
  }

  #place(camera) {
    const exact = this.seconds / meta.stepSeconds;
    const i = Math.min(Math.floor(exact), this.count - 2);
    const frac = exact - i;

    // Straight line between samples: see the class comment.
    for (let axis = 0; axis < 3; axis++) {
      const a = this.points[i * 3 + axis];
      const b = this.points[(i + 1) * 3 + axis];
      this.position.setComponent(axis, a + (b - a) * frac);
    }

    this.marker.position.copy(this.position);

    /* Clamped rather than wrapped at the ends of the track. Wrapping would
       join the last sample to the first, and 48 hours of nodal precession
       separates them -- it would draw a line straight across the scene. A
       short trail near the edges is the honest picture. */
    const lo = Math.max(0, i - this.half);
    const hi = Math.min(this.count - 1, i + this.half);

    /* Line2 has no draw range -- it is instanced geometry, one instance per
       segment -- so a short window is padded by repeating its last point. The
       degenerate segments that creates have zero length and draw nothing. */
    const span = this.window.length / 3;
    for (let k = 0; k < span; k++) {
      const from = Math.min(lo + k, hi) * 3;
      this.window[k * 3] = this.points[from];
      this.window[k * 3 + 1] = this.points[from + 1];
      this.window[k * 3 + 2] = this.points[from + 2];
    }
    this.trail.geometry.setPositions(this.window);

    this.#placeLabel(camera);
  }

  /* The marker and trail are depth-tested against the globe for free; the label
     is a DOM node over the top of the canvas and is not, so it has to be told
     when the Earth is in the way. */
  #placeLabel(camera) {
    if (!this.label) return;

    this.projected.copy(this.position).project(camera);

    // Behind the camera, or off screen.
    const off =
      this.projected.z > 1 ||
      Math.abs(this.projected.x) > 1 ||
      Math.abs(this.projected.y) > 1;

    if (off || this.#occluded(camera)) {
      this.label.removeAttribute("data-shown");
      return;
    }

    const x = (this.projected.x * 0.5 + 0.5) * window.innerWidth;
    const y = (-this.projected.y * 0.5 + 0.5) * window.innerHeight;

    this.label.style.transform = `translate(${x}px, ${y}px)`;
    this.label.dataset.shown = "";
  }

  /** Ray from the camera to the satellite against the unit sphere at the
      origin: if it enters the globe before it arrives, the satellite is round
      the back. */
  #occluded(camera) {
    this.toSat.copy(this.position).sub(camera.position);
    const distance = this.toSat.length();
    this.toSat.divideScalar(distance);

    this.toCentre.set(0, 0, 0).sub(camera.position);
    const along = this.toCentre.dot(this.toSat);
    if (along <= 0 || along >= distance) return false; // globe is not between

    const perpendicular = this.toCentre.lengthSq() - along * along;
    return perpendicular < 1; // EARTH_RADIUS is 1
  }
}
