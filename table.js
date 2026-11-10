const { getTeam } = require("./teams");

const { getTeamCity, buildCityHeatmap } = require("./team-cities");
const { httpsFetch } = require("./lib/https-fetch");
const { formatDisplayDateTime } = require("./lib/display-time");

const CACHE_MS = 15 * 60 * 1000;
const instances = new Map();

function createTable(team) {
  const TEAM_ID = team.id;
  const TEAM_NAME = team.name;
  const FOTMOB_TABLE_PAGE = `https://www.fotmob.com/teams/${TEAM_ID}/table/${team.fotmobSlug}`;
  let cache = { at: 0, data: null };

function teamLogoUrl(id) {
  if (!id) return null;
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
}

function formatNextMatchDate(utcTime) {
  if (!utcTime) return null;
  return formatDisplayDateTime(utcTime);
}

function parseNextOpponent(entry) {
  if (!Array.isArray(entry) || !entry[0]) return null;
  const id = Number(entry[0]);
  const kickoff = entry[5] || entry.at(-1);
  const kickoffIso =
    typeof kickoff === "string" && !Number.isNaN(Date.parse(kickoff))
      ? kickoff
      : null;

  return {
    id,
    name: entry[1] || "TBD",
    logo: teamLogoUrl(id),
    kickoff: kickoffIso,
    kickoffLabel: formatNextMatchDate(kickoffIso),
  };
}

function normalizeRow(row, nextOpponentMap) {
  const next =
    nextOpponentMap?.[String(row.id)] || nextOpponentMap?.[row.id] || null;
  const teamName = row.shortName || row.name;
  const location = getTeamCity(row.id, teamName);

  return {
    rank: row.idx,
    id: row.id,
    name: teamName,
    logo: teamLogoUrl(row.id),
    played: row.played,
    wins: row.wins,
    draws: row.draws,
    losses: row.losses,
    goals: row.scoresStr,
    goalDiff: row.goalConDiff,
    points: row.pts,
    qualColor: row.qualColor || null,
    deduction: row.deduction || null,
    highlighted: row.id === TEAM_ID,
    nextOpponent: parseNextOpponent(next),
    city: location?.city || null,
    lat: location?.lat ?? null,
    lng: location?.lng ?? null,
  };
}

function parseTablePayload(team) {
  const block = team?.table?.[0] || team?.overview?.table?.[0];
  if (!block?.data?.table?.all) {
    return null;
  }

  const { data, nextOpponent = {} } = block;
  const rows = data.table.all.map((row) => normalizeRow(row, nextOpponent));
  const legend = (data.legend || []).map((item) => ({
    title: item.title,
    color: item.color,
  }));
  const deductions = rows
    .filter((row) => row.deduction)
    .map((row) => ({
      team: row.name,
      points: row.deduction,
    }));

  return {
    leagueName: data.leagueName,
    leagueId: data.leagueId,
    leagueUrl: data.pageUrl ? `https://www.fotmob.com${data.pageUrl}` : null,
    rows,
    legend,
    deductions,
  };
}

function extractTeamFromHtml(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) {
    throw new Error("FotMob page did not include table data");
  }

  const payload = JSON.parse(match[1]);
  const team = payload?.props?.pageProps?.fallback?.[`team-${TEAM_ID}`];
  if (!team) {
    throw new Error("FotMob team payload missing from page");
  }

  return team;
}

async function fetchFromFotmob() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);

  try {
    const response = await httpsFetch(FOTMOB_TABLE_PAGE, {
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
    const table = parseTablePayload(extractTeamFromHtml(html));

    if (!table?.rows?.length) {
      throw new Error("No league table found on FotMob page");
    }

    return { table, source: "fotmob" };
  } finally {
    clearTimeout(timer);
  }
}

async function getTable() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }

  const live = await fetchFromFotmob();
  const result = {
    team: TEAM_NAME,
    teamId: TEAM_ID,
    source: live.source,
    sourceUrl: FOTMOB_TABLE_PAGE,
    fetchedAt: new Date().toISOString(),
    ...live.table,
    cities: buildCityHeatmap(live.table.rows),
  };
  cache = { at: Date.now(), data: result };
  return result;
}

return { getTable, FOTMOB_TABLE_PAGE, parseTablePayload, extractTeamFromHtml };
}

function forTeam(slug) {
  const team = getTeam(slug);
  if (!team) return null;
  if (!instances.has(team.slug)) instances.set(team.slug, createTable(team));
  return instances.get(team.slug);
}

const haifa = forTeam("maccabi-haifa");

module.exports = {
  forTeam,
  getTable: (slug) => forTeam(slug).getTable(),
  getMaccabiTable: () => haifa.getTable(),
  FOTMOB_TABLE_PAGE: haifa.FOTMOB_TABLE_PAGE,
  parseTablePayload: haifa.parseTablePayload,
  extractTeamFromHtml: haifa.extractTeamFromHtml,
};
