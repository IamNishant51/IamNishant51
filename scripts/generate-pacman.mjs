#!/usr/bin/env node
/**
 * generate-pacman.mjs — Pac-Man contribution-graph SVG for IamNishant51.
 *
 * Uses the real `pacman-contribution-graph` package (5.5.2, pinned) with the
 * jsdom shim from the dev.to article (JSDOM + pretendToBeVisual, globals set,
 * ArcadeRenderer + svgCallback / gameOverCallback).
 *
 * DATA: the package has no custom-data input — platform 'github' fetches live
 * from GitHub. Without a token it falls back to the Search Commits API, which
 * counts COMMITS ONLY (not the full contribution calendar) and would produce
 * a wrong grid. With a token it uses GraphQL contributionCalendar. There is
 * no real token here, so instead global fetch is intercepted: requests to
 * api.github.com/graphql are answered LOCALLY with the parsed public
 * contribution page (/tmp/contrib.html -> scripts/contrib-grid.json) shaped
 * exactly like the GraphQL response the package expects. No request ever
 * leaves the machine for this; the `accessToken` value below is a dummy
 * placeholder that only selects the GraphQL code path inside the package —
 * it is never transmitted. All other fetch calls throw (fail closed).
 *
 * Per-day counts are REAL (parsed from the page's tool-tips; they sum to
 * 1619, matching the page total). Levels map to GraphQL contributionLevel:
 * 0 NONE, 1 FIRST_QUARTILE, 2 SECOND_QUARTILE, 3 THIRD_QUARTILE,
 * 4 FOURTH_QUARTILE.
 *
 * Usage: node generate-pacman.mjs   (run from scripts/)
 * Output: ../preview/pacman.svg (gameTheme github-dark)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GRID_PATH = path.join(__dirname, 'contrib-grid.json');
// CI override: the GitHub workflow sets PACMAN_OUT=dist/pacman.svg so the
// file lands where the workflow's verify step expects it. Local runs keep
// the preview default.
const OUT_PATH = process.env.PACMAN_OUT
  ? path.resolve(process.env.PACMAN_OUT)
  : path.join(__dirname, '..', 'preview', 'pacman.svg');

// ---- jsdom shim (per the dev.to article) ----
const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
  pretendToBeVisual: true,
});
globalThis.window = dom.window;
globalThis.document = dom.window.document;
// Node 24 exposes navigator as a getter-only global — define it instead.
Object.defineProperty(globalThis, 'navigator', {
  value: dom.window.navigator,
  configurable: true,
  writable: true,
});
globalThis.requestAnimationFrame =
  dom.window.requestAnimationFrame.bind(dom.window);
globalThis.cancelAnimationFrame =
  dom.window.cancelAnimationFrame.bind(dom.window);

// ---- load the parsed contribution grid ----
const grid = JSON.parse(fs.readFileSync(GRID_PATH, 'utf-8'));
const LEVEL_NAMES = [
  'NONE',
  'FIRST_QUARTILE',
  'SECOND_QUARTILE',
  'THIRD_QUARTILE',
  'FOURTH_QUARTILE',
];

// Group days into weeks (Sunday-start). First date 2025-11-16 is a Sunday,
// so week index = floor(daysSinceFirst / 7), day order inside week = Sun..Sat.
const first = new Date(grid[0].date + 'T00:00:00Z');
const weeks = [];
for (const day of grid) {
  const d = new Date(day.date + 'T00:00:00Z');
  const wi = Math.floor((d - first) / (7 * 24 * 60 * 60 * 1000));
  while (weeks.length <= wi) weeks.push({ contributionDays: [] });
  weeks[wi].contributionDays.push({
    date: day.date,
    contributionCount: day.count,
    color: '',
    contributionLevel: LEVEL_NAMES[day.level],
  });
}
console.log(
  `parsed grid: ${grid.length} days, ${weeks.length} weeks, ` +
    `total=${grid.reduce((s, d) => s + d.count, 0)} contributions`,
);

// ---- fetch interceptor: answer the package's GraphQL call locally ----
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  const u = String(url);
  if (u.includes('api.github.com/graphql')) {
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      json: async () => ({
        data: {
          user: {
            contributionsCollection: {
              contributionCalendar: { weeks },
            },
          },
        },
      }),
    };
  }
  throw new Error(`generate-pacman: unexpected network request blocked: ${u}`);
};

// ---- run the game ----
const { ArcadeRenderer } = await import('pacman-contribution-graph');

let wrote = false;
const writeSvg = (svg) => {
  if (typeof svg !== 'string' || svg.length < 1000) {
    throw new Error(`svgCallback got an implausible SVG (${String(svg).length} chars)`);
  }
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, svg);
  wrote = true;
  console.log(`wrote ${OUT_PATH} (${svg.length} bytes)`);
};

const renderer = new ArcadeRenderer({
  game: 'pacman',
  username: 'IamNishant51',
  platform: 'github',
  gameTheme: 'github-dark',
  playerStyle: 'opportunistic',
  showMonthLabels: true,
  // Dummy placeholder only: selects the package's GraphQL code path.
  // It is never sent anywhere — fetch is intercepted above.
  githubSettings: { accessToken: 'unused-local-stub' },
  svgCallback: (svg) => writeSvg(svg),
  gameOverCallback: () => console.log('game over (gameOverCallback)'),
  gameStatsCallback: (stats) => console.log('game stats:', JSON.stringify(stats)),
  pointsIncreasedCallback: () => {},
});

// Watchdog: fail loudly if no SVG arrives.
const watchdog = setTimeout(() => {
  if (!wrote) {
    console.error('ERROR: no SVG produced within 180s');
    process.exit(1);
  }
}, 180_000);

await renderer.start();
console.log('renderer.start() resolved');
// Give callbacks a moment to flush, then exit on status.
setTimeout(() => {
  clearTimeout(watchdog);
  if (!wrote) {
    console.error('ERROR: renderer finished but svgCallback never fired');
    process.exit(1);
  }
  console.log('done');
  process.exit(0);
}, 1000);
