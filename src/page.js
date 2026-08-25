import { Viewer } from "./gfx/sat-view.js";

// Shared by every page except the home screen. globe: false -- these pages are
// here to be read, and the 4MB albedo buys nothing behind a column of text.
// The starfield alone carries the theme.
const viewer = new Viewer(document.querySelector("#scene"), { globe: false });

async function start() {
  /* Same discipline as main.js, and for the same reason: nothing reaches the
     screen until what belongs behind it is already there. Letting the text and
     screenshots paint first and sliding the starfield in underneath a beat
     later reads as a page still assembling itself.

     Awaited together rather than in series -- the font and the six skybox PNGs
     have nothing to do with each other, so neither should wait on the other. */
  await Promise.all([viewer.load(), document.fonts.ready]);

  viewer.start(); // first painted frame, stars already applied
  document.body.dataset.ready = ""; // lets the banner and the content in
}

start();
