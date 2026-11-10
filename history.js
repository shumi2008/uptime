const fs = require("fs");
const path = require("path");
const { httpsFetch } = require("./lib/https-fetch");

const { getTeam } = require("./teams");

const CACHE_MS = 6 * 60 * 60 * 1000;
const caches = new Map();

function seasonSortKey(season) {
  const match = String(season).match(/^(\d{4})/);
  return match ? Number(match[1]) : 0;
}

function seasonLabelFromStartYear(startYear) {
  const endShort = String((startYear + 1) % 100).padStart(2, "0");
  return `${startYear}/${endShort}`;
}

function currentSeasonStartYear(now = new Date()) {
  const year = now.getFullYear();
  const month = now.getMonth();
  return month >= 6 ? year : year - 1;
}

function fillCompleteSeasonHistory(rows, foundedYear = 1913) {
  const bySeason = new Map();
  for (const row of rows) {
    bySeason.set(normalizeSeasonLabel(row.season), { ...row });
  }

  const latestKnown = rows.reduce(
    (max, row) => Math.max(max, seasonSortKey(row.season)),
    foundedYear
  );
  const endYear = Math.max(latestKnown, currentSeasonStartYear());
  const complete = [];

  for (let year = foundedYear; year <= endYear; year += 1) {
    const label = normalizeSeasonLabel(seasonLabelFromStartYear(year));
    const existing = bySeason.get(label);
    if (existing) {
      complete.push(existing);
      continue;
    }
    complete.push({
      season: label,
      division: null,
      position: null,
      source: "placeholder",
      noLeagueData: true,
    });
  }

  return complete;
}

function normalizeSeasonLabel(season) {
  const raw = String(season).trim().replace(/\s+/g, "").replace(/–/g, "-");
  const slash = raw.match(/^(\d{4})[/-](\d{2,4})$/);
  if (slash) {
    let end = slash[2];
    if (end.length === 4) end = end.slice(2);
    return `${slash[1]}/${end}`;
  }
  const dash = raw.match(/^(\d{4})-(\d{2})$/);
  if (dash) return `${dash[1]}/${dash[2]}`;
  return raw;
}

function loadStaticSeasons(team) {
  if (!team.historyFile) return [];
  const STATIC_PATH = path.join(__dirname, "data", team.historyFile);
  let rows;
  try {
    rows = JSON.parse(fs.readFileSync(STATIC_PATH, "utf8"));
  } catch {
    // Missing static file: fall back to FotMob rows only.
    return [];
  }  
  return rows.map((row) => ({
    season: normalizeSeasonLabel(row.season),
    division: row.division,
    position: row.position,
    source: "wikipedia",
  }));
}

function extractTeamFromHtml(html, TEAM_ID) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;

  const payload = JSON.parse(match[1]);
  return payload?.props?.pageProps?.fallback?.[`team-${TEAM_ID}`] || null;
}

async function fetchFotmobHistoryRanks(team) {
  const TEAM_ID = team.id;
  const FOTMOB_HISTORY_PAGE = fotmobHistoryPage(team);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await httpsFetch(FOTMOB_HISTORY_PAGE, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`FotMob HTTP ${response.status}`);
    }

    const html = await response.text();
    const payload = extractTeamFromHtml(html, TEAM_ID);
    const ranks = payload?.history?.historicalTableData?.ranks;
    if (!Array.isArray(ranks)) return [];

    return ranks
      .filter(
        (row) =>
          row.templateId === team.leagueId ||
          String(row.tournamentName || "").toLowerCase().includes(team.leagueNamePattern)
      )
      .map((row) => ({
        season: normalizeSeasonLabel(row.seasonName),
        division: row.tournamentName || team.leagueLabel,
        position: row.position,
        source: "fotmob",
        inProgress: row.stats?.points === -1,
      }));
  } finally {
    clearTimeout(timer);
  }
}

function fotmobHistoryPage(team) {
  return `https://www.fotmob.com/en-GB/teams/${team.id}/history/${team.fotmobSlug}`;
}

function mergeSeasonRows(staticRows, fotmobRows) {
  const bySeason = new Map();

  for (const row of staticRows) {
    bySeason.set(normalizeSeasonLabel(row.season), { ...row });
  }

  for (const row of fotmobRows) {
    const key = normalizeSeasonLabel(row.season);
    const existing = bySeason.get(key) || {
      season: key,
      division: row.division,
      position: row.position,
    };
    bySeason.set(key, {
      ...existing,
      division: row.division || existing.division,
      position: row.position,
      source: row.source,
      inProgress: row.inProgress,
    });
  }

  return [...bySeason.values()].sort(
    (a, b) => seasonSortKey(a.season) - seasonSortKey(b.season)
  );
}

async function getHistory(slug) {
  const team = getTeam(slug);
  if (!team) throw new Error("Unknown team");
  const TEAM_ID = team.id;
  const TEAM_NAME = team.name;
  const FOTMOB_HISTORY_PAGE = fotmobHistoryPage(team);
  const cache = caches.get(team.slug) || { at: 0, data: null };
  if (cache.data && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }

  const staticRows = loadStaticSeasons(team);
  let fotmobRows = [];

  try {
    fotmobRows = await fetchFotmobHistoryRanks(team);
  } catch {
    // Static Wikipedia-derived rows remain available offline.
  }

  const merged = mergeSeasonRows(staticRows, fotmobRows);
  const seasons = fillCompleteSeasonHistory(merged, team.founded);
  const chartedSeasons = seasons.filter((row) => row.position != null);
  const topFlightPattern = team.historyDivisionPattern;
  const titles = chartedSeasons.filter(
    (row) => row.position === 1 && topFlightPattern.test(row.division || "")
  ).length;
  const firstPlaceFinishes = chartedSeasons.filter(
    (row) => row.position === 1
  ).length;

  const result = {
    team: TEAM_NAME,
    teamId: TEAM_ID,
    clubFounded: team.founded,
    seasons,
    chartedSeasons: chartedSeasons.length,
    seasonsWithoutTable: seasons.length - chartedSeasons.length,
    titles,
    firstPlaceFinishes,
    sourceUrl: team.wikiSeasonsUrl,
    fotmobUrl: FOTMOB_HISTORY_PAGE,
    fetchedAt: new Date().toISOString(),
    note: `Every season from ${seasonLabelFromStartYear(team.founded)} (club founding) through the current campaign. ${
      team.historyFile
        ? `Documented league finishes from Wikipedia (from 1949/50) and recent ${team.leagueLabel} rows from FotMob; `
        : `League finishes from FotMob (${team.leagueLabel}); `
    }other years have no recorded league table position.`,
  };

  caches.set(team.slug, { at: Date.now(), data: result });
  return result;
}

module.exports = {
  getHistory,
  getMaccabiHistory: () => getHistory("maccabi-haifa"),
  normalizeSeasonLabel,
  mergeSeasonRows,
  fillCompleteSeasonHistory,
  seasonLabelFromStartYear,
};
