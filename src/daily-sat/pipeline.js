/* Satellite of the day.
 *
 * Picks one active payload, propagates it for 48 hours with SGP4, and writes
 * the track out as a flat table of samples. Run daily by CI; the site reads
 * the CSV and never runs SGP4 itself, which keeps satellite.js out of the
 * browser bundle entirely.
 *
 *   node src/daily-sat/pipeline.js
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import * as satellite from "satellite.js";

// CelesTrak's "active" group, as three-line TLE sets. No account, no login
// step, no credentials to keep out of the repo -- the whole reason for
// preferring it over Space-Track for something a CI job runs unattended.
const GROUP = process.env.SAT_GROUP ?? "active";
const CATALOG = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${GROUP}&FORMAT=tle`;

const WINDOW_S = 48 * 60 * 60;
const STEP_S = 30;

/* 30s between samples so the site can join them with straight lines. The error
   that introduces is the gap between a chord and the arc it cuts: at LEO the
   satellite covers ~225km in 30s on a ~6800km radius, which leaves the chord
   under a kilometre from the true path at its worst. The globe renders at
   roughly 240px per Earth radius, so that is about 0.04px -- far below
   anything visible, and it buys much simpler code at the far end than a
   spline would. */
/* Lives under src/ rather than public/, which means the site has to *import*
   it: anything here only reaches a build through the bundler. A bare fetch of
   this path works in dev and 404s in production. */
const OUT_CSV = "src/daily-sat/data/sat.csv";
const OUT_META = "src/daily-sat/data/sat.json";

/* CelesTrak answers 403 -- not 304 -- when you ask for a group you have
   already downloaded and it has not changed since; their data refreshes every
   two hours. That is a deliberate "you already have this", not a block, so the
   catalog is kept locally and reused when they say so. Without this the job
   simply fails whenever it runs twice inside one refresh window, which is most
   of the time while developing.

   CelesTrak tracks this per group, so the cache is keyed the same way.
   SAT_GROUP overrides the group, which is mostly how you test this without
   waiting out a refresh window. */
const CACHE_DIR = "src/daily-sat/.cache";
const CACHE_FILE = `${CACHE_DIR}/${GROUP}.tle`;

/** Deterministic per-day pick: re-running the job on the same date has to
    choose the same object, or a retried or duplicated CI run would swap the
    satellite out from under a page that is already live. Seeded on the UTC
    date, so it only changes when the day does. */
function dailyRandom(dayKey) {
  // xmur3 seed + mulberry32: small, fast, and good enough to pick an index.
  let h = 1779033703 ^ dayKey.length;
  for (let i = 0; i < dayKey.length; i++) {
    h = Math.imul(h ^ dayKey.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Splits the three-line format into {name, line1, line2}. */
function parseCatalog(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const out = [];

  for (let i = 0; i + 2 < lines.length + 1; i += 3) {
    const [name, line1, line2] = lines.slice(i, i + 3);
    // Guard against a truncated tail: a partial set at the end would otherwise
    // produce a satrec that fails much later, mid-propagation.
    if (!line1?.startsWith("1 ") || !line2?.startsWith("2 ")) continue;
    out.push({ name: name.trim(), line1, line2 });
  }

  return out;
}

/** Propagates across the whole window, or returns null if the object cannot
    hold up for it. Decayed and near-decayed objects are still listed and SGP4
    diverges on them, so this is a filter as much as a computation. */
function track(entry, start) {
  const satrec = satellite.twoline2satrec(entry.line1, entry.line2);
  if (satrec.error !== 0) return null;

  const rows = [];

  for (let t = 0; t <= WINDOW_S; t += STEP_S) {
    const when = new Date(start.getTime() + t * 1000);
    const state = satellite.propagate(satrec, when);
    const p = state?.position;

    // propagate() reports failure by returning no position rather than by
    // throwing, and a diverging orbit shows up as non-finite components.
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
      return null;
    }

    rows.push(`${t},${p.x.toFixed(3)},${p.y.toFixed(3)},${p.z.toFixed(3)}`);
  }

  return { satrec, rows };
}

/** Returns the raw catalog, from CelesTrak if they will serve it and from the
    local copy if they say we already have it. */
async function fetchCatalog() {
  const response = await fetch(CATALOG, {
    // CelesTrak asks that automated clients identify themselves.
    headers: {
      "User-Agent":
        "nicholashirsch-portfolio/0.1 (satellite-of-the-day; +https://github.com/nicholashirsch/nicholashirsch.github.io)",
      Accept: "text/plain",
    },
  });

  if (response.ok) {
    const text = await response.text();
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(CACHE_FILE, text, "utf8");
    return text;
  }

  if (response.status === 403) {
    const cached = await readFile(CACHE_FILE, "utf8").catch(() => null);
    if (cached) {
      console.log("celestrak: no new data since last download, using cache");
      return cached;
    }
  }

  throw new Error(
    `CelesTrak returned ${response.status}: ${(await response.text()).trim()}`,
  );
}

async function main() {
  const catalog = parseCatalog(await fetchCatalog());
  if (catalog.length === 0) throw new Error("catalog parsed to zero entries");

  /* Midnight UTC rather than the moment the job happens to run, so the track
     lines up with the date it is named for and two runs on the same day are
     byte-identical. */
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const dayKey = start.toISOString().slice(0, 10);

  const random = dailyRandom(dayKey);

  /* Walk from a seeded starting index rather than re-rolling: a failed
     candidate must not change which object the next attempt lands on, or the
     pick stops being reproducible for the day. */
  let index = Math.floor(random() * catalog.length);
  let picked = null;

  for (let attempt = 0; attempt < 50 && !picked; attempt++) {
    const entry = catalog[(index + attempt) % catalog.length];
    const result = track(entry, start);
    if (result) picked = { entry, ...result };
  }

  if (!picked) throw new Error("no candidate propagated cleanly in 50 attempts");

  await writeFile(OUT_CSV, `t,x,y,z\n${picked.rows.join("\n")}\n`, "utf8");

  /* The CSV is positions and nothing else, so the name the page has to display
     rides alongside it. Also records the frame: SGP4 emits TEME, which is not
     quite the J2000 the scene is built around. */
  await writeFile(
    OUT_META,
    JSON.stringify(
      {
        name: picked.entry.name,
        noradId: picked.satrec.satnum,
        date: dayKey,
        startUtc: start.toISOString(),
        stepSeconds: STEP_S,
        windowSeconds: WINDOW_S,
        /* satrec.no is mean motion in radians per minute. The site draws only
           half a period either side of the satellite, so it needs this to know
           how many samples that spans -- deriving it here keeps the browser
           from having to understand orbital elements at all. */
        periodSeconds: Math.round(((2 * Math.PI) / picked.satrec.no) * 60),
        samples: picked.rows.length,
        frame: "TEME",
        units: "km",
        source: `CelesTrak GP (${GROUP})`,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );

  console.log(
    `${picked.entry.name} (${picked.satrec.satnum}) -- ${picked.rows.length} samples -> ${OUT_CSV}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
