// ============================================================================
// World Cup 2026 feed builder  —  runs inside GitHub Actions (Node 20+)
// ----------------------------------------------------------------------------
// This is the server-side half of the setup. It runs ON GitHub's servers (not
// in any reader's browser), so it CAN call SportMonks (no CORS limit) and it
// keeps the API token hidden in an encrypted GitHub Actions Secret.
//
// It writes data/fixtures.json — a plain static file that GitHub Pages serves
// next to index.html. The page reads that file (same origin → no CORS), so no
// token ever reaches a browser.
//
// Token comes from the WC_API_TOKEN repo secret (Settings → Secrets and
// variables → Actions). Never hard-code it here.
// ============================================================================

import { writeFile, mkdir } from "node:fs/promises";

const TOKEN = process.env.WC_API_TOKEN;
if (!TOKEN) {
  console.error("WC_API_TOKEN is not set. Add it as a repository secret.");
  process.exit(1);
}

const LEAGUE = 732; // FIFA World Cup
const INC = "participants;scores;state;venue;periods;group;events";
const TOURNAMENT_START = Date.parse("2026-06-11T00:00:00Z");

const TOURNAMENT_END = Date.parse("2026-07-20T00:00:00Z"); // final + buffer

const ymd = (ms) => new Date(ms).toISOString().slice(0, 10);
// Reach back to the tournament's first day AND forward to the end of the
// tournament, so the feed always contains the FULL group schedule. The
// standings card seeds every group's four-team table from these fixtures
// (showing all groups, with strikes until games are played), and group
// standings sum every match played so far.
const start = ymd(TOURNAMENT_START);
const end = ymd(TOURNAMENT_END);

async function fetchAllPages() {
  let page = 1;
  let all = [];
  let hasMore = true;
  while (hasMore && page <= 15) {
    const url =
      `https://api.sportmonks.com/v3/football/fixtures/between/${start}/${end}` +
      `?api_token=${TOKEN}` +
      `&include=${INC}` +
      `&filters=fixtureLeagues:${LEAGUE}` +
      `&per_page=50&page=${page}`;
    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`SportMonks HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    all = all.concat(json.data || []);
    hasMore = !!(json.pagination && json.pagination.has_more);
    page++;
  }
  return all;
}

try {
  const data = await fetchAllPages();
  await mkdir("data", { recursive: true });
  const payload = {
    data,
    meta: {
      count: data.length,
      window: { start, end },
      generated_at: new Date().toISOString(),
    },
  };
  await writeFile("data/fixtures.json", JSON.stringify(payload));
  console.log(`Wrote data/fixtures.json — ${data.length} fixtures (window ${start} → ${end}).`);
} catch (err) {
  // Do NOT overwrite the last good file on an upstream error — exit non-zero so
  // the workflow step is marked failed but the previous data/fixtures.json
  // (and the page's demo fallback) keep working.
  console.error("Feed update failed:", err.message);
  process.exit(1);
}
