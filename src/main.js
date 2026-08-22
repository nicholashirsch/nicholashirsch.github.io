import { Terminal } from "./gfx/terminal.js";

const NAME = "NICHOLAS HIRSCH";

const terminal = new Terminal(document.querySelector(".terminal"));

async function start() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    terminal.write(NAME);
    return;
  }

  // CLAUDE: The font loads with display=swap, so the browser paints in the 
  // fallback face first and swaps when JetBrains Mono arrives. Typing before 
  // that happens animates the name in the wrong font, then reflows mid-word.
  await document.fonts.ready;

  await terminal.type(NAME);
}

start();
