import * as THREE from "three";

/* Imported, not referenced by URL: assets under src/ go through the bundler,
   so these get hashed for cache-busting, follow vite's base path on their own,
   and a mistyped name fails the build instead of 404ing at runtime. */
import earthAlbedo from "./textures/earth.jpg";
import skyboxRight from "./textures/skybox/skybox_right1.png";
import skyboxLeft from "./textures/skybox/skybox_left2.png";
import skyboxTop from "./textures/skybox/skybox_top3.png";
import skyboxBottom from "./textures/skybox/skybox_bottom4.png";
import skyboxFront from "./textures/skybox/skybox_front5.png";
import skyboxBack from "./textures/skybox/skybox_back6.png";

// CubeTextureLoader wants +x, -x, +y, -y, +z, -z, in that order.
const SKYBOX_FACES = [
  skyboxRight,
  skyboxLeft,
  skyboxTop,
  skyboxBottom,
  skyboxFront,
  skyboxBack,
];

const EARTH_RADIUS = 1; // scene units -- everything else is measured off this
/* The limb is a silhouette, so the segment count shows up directly as a
   faceted edge -- far more visible than any error across the lit face. One
   sphere, so the extra triangles cost nothing worth counting. */
const EARTH_SEGMENTS = [192, 96];
const ROTATION_PERIOD_S = 120; // a real sidereal day reads as motionless

/* The scene is ECI (Earth-Centered Inertial): +X is the vernal equinox, +Z is
   the north celestial pole, +Y completes the right-handed set. Three defaults
   to Y-up, so the camera's up vector is overridden below. Worth the deviation:
   propagated state vectors come out of SGP4 in exactly this frame, so the
   satellite work drops in without swizzling an axis at every step. */
const VERNAL_EQUINOX = new THREE.Vector3(1, 0, 0);
const NORTH = new THREE.Vector3(0, 0, 1);

const FOV = 45;
const EARTH_VIEWPORT_FRACTION = 0.45; // of the viewport's *shorter* side

const SUN_INTENSITY = 2.5;
const AMBIENT_INTENSITY = 0.15; // keeps the night side off pure black

/* In ECI the Earth's axis IS +Z by definition, so the 23.44 degrees of
   obliquity belongs to the sun's path rather than to the globe: the ecliptic
   is the equator tilted by that much. Solar longitude 0 is the equinox itself,
   which sits behind the camera and lights the disc flat -- offsetting it puts
   a terminator on screen. Drive it from the date later if you want the real
   season. */
const OBLIQUITY = THREE.MathUtils.degToRad(23.44);
const SOLAR_LONGITUDE = THREE.MathUtils.degToRad(55);
const SUN_DIRECTION = new THREE.Vector3(
  Math.cos(SOLAR_LONGITUDE),
  Math.sin(SOLAR_LONGITUDE) * Math.cos(OBLIQUITY),
  Math.sin(SOLAR_LONGITUDE) * Math.sin(OBLIQUITY),
);

/** The home-screen globe. Everything it owns hangs off the instance, so the
    satellite work can reach in later and add to the same scene. */
export class Viewer {
  constructor(canvas) {
    this.canvas = canvas;
    this.clock = new THREE.Clock();
    this.started = false; // has start() ever been called
    this.running = false; // is the animation loop live right now

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);

    this.ambient = new THREE.AmbientLight(0xffffff, AMBIENT_INTENSITY);
    this.sun = new THREE.DirectionalLight(0xffffff, SUN_INTENSITY);
    this.sun.position.copy(SUN_DIRECTION);
    this.scene.add(this.ambient, this.sun);

    /* SphereGeometry lays its poles on +Y. Rotating the geometry once puts
       them on ECI +Z, which leaves the equator in the XY plane and the mesh's
       own axes agreeing with the frame -- cheaper and less error-prone than a
       wrapper group correcting for it forever.

       It also lands the map's prime meridian on +X, so earth.rotation.z reads
       directly as Greenwich Mean Sidereal Time once real time drives it. */
    const globe = new THREE.SphereGeometry(EARTH_RADIUS, ...EARTH_SEGMENTS);
    globe.rotateX(Math.PI / 2);

    this.earth = new THREE.Mesh(
      globe,
      new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 }),
    );
    this.scene.add(this.earth);

    this.stars = null; // set once the cubemap arrives, if it ever does

    this.#resize();
    this.onResize = () => this.#resize();
    // Guarded on started: tabbing away and back before load() resolves must
    // not paint an untextured frame the page is deliberately hiding.
    this.onVisibility = () => {
      if (!this.started) return;
      if (document.hidden) this.stop();
      else this.start();
    };
    window.addEventListener("resize", this.onResize);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  /** Resolves once the scene is ready to be seen -- main.js holds the page
      black until it does, so nothing renders before this.

      The bundler guarantees the files exist, but the albedo map is ~4MB and a
      dropped request should not strand the page on black forever: a miss
      resolves anyway and the globe just comes up untextured. */
  async load() {
    const [stars, albedo] = await Promise.all([
      new THREE.CubeTextureLoader().loadAsync(SKYBOX_FACES).catch(() => null),
      new THREE.TextureLoader().loadAsync(earthAlbedo).catch(() => null),
    ]);

    if (stars) {
      stars.colorSpace = THREE.SRGBColorSpace;
      this.stars = stars;
      this.scene.background = stars;
    }

    if (albedo) {
      albedo.colorSpace = THREE.SRGBColorSpace; // or it renders washed out

      /* Toward the limb the surface turns nearly edge-on, so a texel spans
         many pixels one way and almost none the other. Isotropic filtering
         picks one mip level for both and smears; anisotropy is what keeps
         that band sharp. Typically 16 -- log it if the edge still looks soft. */
      albedo.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      this.earth.material.map = albedo;
      this.earth.material.needsUpdate = true;
    }

    return this; // the caller starts us, which paints the first frame
  }

  start() {
    this.started = true;

    if (this.#still) {
      this.#render();
      return this;
    }

    this.clock.getDelta(); // discard time spent stopped, else the globe jumps
    this.running = true;
    this.renderer.setAnimationLoop(() => this.#frame());
    return this;
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    return this;
  }

  get #still() {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  #frame() {
    const turns = this.clock.getDelta() / ROTATION_PERIOD_S;
    this.earth.rotation.z += turns * Math.PI * 2; // eastward, seen from north
    this.#render();
  }

  #render() {
    this.renderer.render(this.scene, this.camera);
  }

  /** Sits the camera on the vernal equinox axis looking back down it, north
      celestial pole up. That puts the equatorial plane edge-on -- perpendicular
      to the screen, projecting to a horizontal line through the centre.

      The distance is derived rather than fixed so the globe covers a set
      fraction of the viewport's shorter side: it neither shrinks to a dot on a
      wide monitor nor crops out of a narrow phone window. */
  #fitCamera(aspect) {
    const halfFov = THREE.MathUtils.degToRad(FOV) / 2;
    const fill = EARTH_VIEWPORT_FRACTION * Math.tan(halfFov) * Math.min(1, aspect);

    this.camera.up.copy(NORTH); // must precede lookAt, which reads it
    this.camera.position.copy(VERNAL_EQUINOX).setLength(EARTH_RADIUS / fill);
    this.camera.lookAt(0, 0, 0);
  }

  #resize() {
    // clientWidth is 0 if this runs before the canvas has been laid out.
    const width = this.canvas.clientWidth || window.innerWidth;
    const height = this.canvas.clientHeight || window.innerHeight;

    this.renderer.setSize(width, height, false); // false: CSS owns the size
    this.camera.aspect = width / height;
    this.#fitCamera(this.camera.aspect);
    this.camera.updateProjectionMatrix();
  }
}
