import { Terminal } from "./gfx/terminal.js";
import { Viewer } from "./gfx/sat-view.js";
import { SatTrack } from "./gfx/sat-track.js";

// Typed in order, one after the last finishes. Each selector is a terminal
// root of its own -- the class types into a single .output.
const LINES = [
  ["h1.terminal", "NICHOLAS HIRSCH"],
  [".tagline", "Aspiring GNC engineer"],
  ['.nav a[href="/projects.html"]', "projects"],
  ['.nav a[href="/contact.html"]', "contact"],
];

// No per-line options: speed and jitter live in Terminal's defaults, so the
// whole page shares one cadence and there is one knob to turn.
const lines = LINES.map(([selector, text]) => ({
  terminal: new Terminal(document.querySelector(selector)),
  text,
}));

const viewer = new Viewer(document.querySelector("#scene"));
const track = new SatTrack({
  label: document.querySelector(".sat-label"),
  caption: document.querySelector(".sat-caption"),
});

async function start() {
  // Nothing reaches the screen until both of these land, so the page stays
  // black rather than showing a grey untextured globe for a beat. They are
  // awaited together, not in series -- neither one waits on the other.
  //
  // CLAUDE: The font loads with display=swap, so the browser paints in the
  // fallback face first and swaps when JetBrains Mono arrives. Typing before
  // that happens animates the name in the wrong font, then reflows mid-word.
  await Promise.all([viewer.load(), track.load(), document.fonts.ready]);

  track.attach(viewer); // adds itself to the scene and takes the frame tick
  viewer.start(); // first painted frame, textures already applied
  document.body.dataset.ready = ""; // lets the static banner in

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    for (const { terminal, text } of lines) terminal.write(text);
    return;
  }

  for (const { terminal, text } of lines) await terminal.type(text);
}

start();
