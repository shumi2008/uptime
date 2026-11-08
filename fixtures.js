const TEAM_ID = 10185;
const TEAM_NAME = "Maccabi Haifa";
const LIGAT_LEAGUE_ID = 127;
const FOTMOB_PAGE =
  "https://www.fotmob.com/teams/10185/fixtures/maccabi-haifa";

const { getTeamCity } = require("./team-cities");
const { httpsFetch } = require("./lib/https-fetch");
const { formatDisplayDateTime } = require("./lib/display-time");

const CACHE_MS = 15 * 60 * 1000;
let cache = { at: 0, data: null };

function parseFixtureDate(utcTime) {
  if (!utcTime) return null;
  const date = new Date(utcTime);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatKickoff(date) {
  if (!date) return "TBD";
  return formatDisplayDateTime(date) || "TBD";
}

function teamName(value) {
  if (!value) return "TBD";
  if (typeof value === "string") return value;
  return value.name || value.shortName || "TBD";
}

function teamId(value) {
  if (!value || typeof value === "string") return null;
  return value.id || null;
}

function teamLogoUrl(id) {
  if (!id) return null;
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
}

function playerPhotoUrl(id) {
  if (!id) return null;
  return `https://images.fotmob.com/image_resources/playerimages/${id}.png`;
}

function sortGoalScorers(scorers) {
  return scorers.sort(
    (a, b) => b.goals - a.goals || String(a.name).localeCompare(String(b.name))
  );
}

function findGoalsStat(team) {
  const groups = team?.stats?.players;
  if (!Array.isArray(groups)) return null;
  return (
    groups.find(
      (group) => group?.name === "goals" || group?.participant?.stat?.name === "goals"
    ) || null
  );
}

function scorersFromGoalsPayload(payload) {
  const statList = payload?.TopLists?.[0]?.StatList;
  if (!Array.isArray(statList)) return [];

  return sortGoalScorers(
    statList
      .filter((row) => Number(row.TeamId) === TEAM_ID && Number(row.StatValue) > 0)
      .map((row) => ({
        id: row.ParticiantId,
        name: row.ParticipantName,
        goals: Number(row.StatValue),
        photo: playerPhotoUrl(row.ParticiantId),
      }))
      .filter((row) => row.id && row.name)
  );
}

function scorersFromTopThree(goalsStat) {
  const rows = Array.isArray(goalsStat?.topThree) ? goalsStat.topThree : [];
  return sortGoalScorers(
    rows
      .filter((row) => Number(row.teamId) === TEAM_ID && Number(row.value) > 0)
      .map((row) => ({
        id: row.id,
        name: row.name,
        goals: Number(row.value),
        photo: playerPhotoUrl(row.id),
      }))
      .filter((row) => row.id && row.name)
  );
}

async function loadGoalScorers(team) {
  let goalsStat = findGoalsStat(team);

  if (!goalsStat?.fetchAllUrl) {
    try {
      const response = await httpsFetch(
        "https://www.fotmob.com/teams/10185/squad/maccabi-haifa",
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml",
          },
        }
      );
      if (response.ok) {
        const html = await response.text();
        goalsStat = findGoalsStat(extractTeamFromHtml(html));
      }
    } catch {
      goalsStat = goalsStat || null;
    }
  }

  if (goalsStat?.fetchAllUrl) {
    try {
      const response = await httpsFetch(goalsStat.fetchAllUrl, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
      });
      if (response.ok) {
        const scorers = scorersFromGoalsPayload(await response.json());
        if (scorers.length) return scorers;
      }
    } catch {
      // Fall through to the short list already on the team payload.
    }
  }

  return scorersFromTopThree(goalsStat);
}

function isFinished(raw) {
  const status = raw.status || {};
  if (status.finished || status.cancelled) return true;
  const reason = (status.reason?.short || status.reason?.long || "").toLowerCase();
  return reason === "ft" || reason.includes("finished") || reason.includes("full time");
}

function normalizeFixture(raw) {
  const homeTeam = raw.home || raw.homeTeam;
  const awayTeam = raw.away || raw.awayTeam;
  const home = teamName(homeTeam);
  const away = teamName(awayTeam);
  const homeId = teamId(homeTeam);
  const awayId = teamId(awayTeam);
  const status = raw.status || {};
  const kickoff = parseFixtureDate(status.utcTime || raw.utcTime);
  const finished = isFinished(raw);
  const homeScore =
    finished && homeTeam?.score != null ? Number(homeTeam.score) : null;
  const awayScore =
    finished && awayTeam?.score != null ? Number(awayTeam.score) : null;
  const scoreLabel =
    finished && status.scoreStr
      ? status.scoreStr
      : finished && homeScore != null && awayScore != null
        ? `${homeScore} - ${awayScore}`
        : null;
  const competition =
    raw.tournament?.name ||
    raw.league?.name ||
    raw.tournamentName ||
    raw.leagueName ||
    "Fixture";

  return {
    id: String(raw.id || `${home}-${away}-${kickoff?.toISOString() || "tbd"}`),
    kickoff: kickoff?.toISOString() || null,
    kickoffLabel: formatKickoff(kickoff),
    competition,
    home,
    away,
    homeId,
    awayId,
    homeLogo: teamLogoUrl(homeId),
    awayLogo: teamLogoUrl(awayId),
    finished,
    homeScore,
    awayScore,
    scoreLabel,
    isHome: home.toLowerCase().includes("maccabi haifa"),
    opponent: home.toLowerCase().includes("maccabi haifa") ? away : home,
    venue: home.toLowerCase().includes("maccabi haifa") ? "Home" : "Away",
  };
}

function isLeagueFixture(raw) {
  const leagueId = raw.tournament?.leagueId;
  if (leagueId === LIGAT_LEAGUE_ID) return true;
  const name = raw.tournament?.name || "";
  return name.toLowerCase().includes("ligat ha");
}

function getHaifaOutcome(raw, fixture) {
  if (typeof raw.result === "number") {
    if (raw.result === 1) return "win";
    if (raw.result === -1) return "loss";
    if (raw.result === 0) return "draw";
  }

  if (fixture.homeScore == null || fixture.awayScore == null) {
    return null;
  }

  const haifaScore = fixture.isHome ? fixture.homeScore : fixture.awayScore;
  const opponentScore = fixture.isHome ? fixture.awayScore : fixture.homeScore;

  if (haifaScore > opponentScore) return "win";
  if (haifaScore < opponentScore) return "loss";
  return "draw";
}

function getMatchVenue(raw, fixture) {
  const homeTeam = raw.home || raw.homeTeam;
  const venueTeamId = teamId(homeTeam) || fixture.homeId;
  const venueTeamName = teamName(homeTeam) || fixture.home;
  const location = getTeamCity(venueTeamId, venueTeamName);

  if (!location) {
    return null;
  }

  return {
    city: location.city,
    lat: location.lat,
    lng: location.lng,
    venueTeamId,
    venueTeamName,
  };
}

function normalizeLeagueResult(raw) {
  const fixture = normalizeFixture(raw);
  if (!fixture.finished || !isLeagueFixture(raw)) {
    return null;
  }

  const outcome = getHaifaOutcome(raw, fixture);
  if (outcome !== "win" && outcome !== "loss") {
    return null;
  }

  const venue = getMatchVenue(raw, fixture);
  if (!venue) {
    return null;
  }

  return {
    id: fixture.id,
    kickoff: fixture.kickoff,
    kickoffLabel: fixture.kickoffLabel,
    competition: fixture.competition,
    home: fixture.home,
    away: fixture.away,
    scoreLabel: fixture.scoreLabel,
    opponent: fixture.opponent,
    isHome: fixture.isHome,
    outcome,
    city: venue.city,
    lat: venue.lat,
    lng: venue.lng,
    venueTeamName: venue.venueTeamName,
  };
}

function parseLeagueResultsFromFixtures(rawFixtures) {
  return (rawFixtures || [])
    .map(normalizeLeagueResult)
    .filter(Boolean)
    .sort((a, b) => {
      const ta = a.kickoff ? Date.parse(a.kickoff) : 0;
      const tb = b.kickoff ? Date.parse(b.kickoff) : 0;
      return ta - tb;
    });
}

function summarizeLeagueRecord(rawFixtures) {
  let wins = 0;
  let losses = 0;
  let ties = 0;

  for (const raw of rawFixtures || []) {
    if (!isLeagueFixture(raw)) continue;

    const fixture = normalizeFixture(raw);
    if (!fixture.finished) continue;

    const outcome = getHaifaOutcome(raw, fixture);
    if (outcome === "win") wins += 1;
    else if (outcome === "loss") losses += 1;
    else if (outcome === "draw") ties += 1;
  }

  return { wins, losses, ties };
}

function parseLeagueMatchGoals(rawFixtures) {
  const items = [];

  for (const raw of rawFixtures || []) {
    if (!isLeagueFixture(raw)) continue;

    const fixture = normalizeFixture(raw);
    if (!fixture.finished) continue;
    if (fixture.homeScore == null || fixture.awayScore == null) continue;

    const goalsScored = fixture.isHome ? fixture.homeScore : fixture.awayScore;
    const goalsConceded = fixture.isHome ? fixture.awayScore : fixture.homeScore;

    items.push({
      id: fixture.id,
      kickoff: fixture.kickoff,
      kickoffLabel: fixture.kickoffLabel,
      opponent: fixture.opponent,
      opponentLogo: fixture.isHome ? fixture.awayLogo : fixture.homeLogo,
      isHome: fixture.isHome,
      goalsScored,
      goalsConceded,
      scoreLabel: fixture.scoreLabel,
      outcome: getHaifaOutcome(raw, fixture),
    });
  }

  return items.sort((a, b) => {
    const ta = a.kickoff ? Date.parse(a.kickoff) : 0;
    const tb = b.kickoff ? Date.parse(b.kickoff) : 0;
    return ta - tb;
  });
}

async function fetchFixturePage(url) {
  const response = await httpsFetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "application/json,text/html,application/xhtml+xml",
    },
  });

  if (!response.ok) {
    throw new Error(`FotMob HTTP ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  const html = await response.text();
  return extractTeamFromHtml(html);
}

async function collectAllRawFixturesAsync(team) {
  const collected = new Map();
  const addBatch = (batch) => {
    for (const raw of batch || []) {
      if (raw?.id != null) {
        collected.set(String(raw.id), raw);
      }
    }
  };

  addBatch(team?.fixtures?.allFixtures?.fixtures);
  addBatch(team?.overview?.overviewFixtures);

  let nextUrl = team?.fixtures?.allFixtures?.previousFixturesUrl;
  let pages = 0;

  while (nextUrl && pages < 30) {
    try {
      const page = await fetchFixturePage(nextUrl);
      const batch = page?.fixtures || page?.matches || page?.allFixtures?.fixtures;
      if (!Array.isArray(batch) || !batch.length) {
        break;
      }

      addBatch(batch);
      nextUrl = page?.previousFixturesUrl || null;
      pages += 1;
    } catch {
      break;
    }
  }

  return Array.from(collected.values());
}

async function parseAllLeagueResultsAsync(team) {
  const rawFixtures = await collectAllRawFixturesAsync(team);
  return parseLeagueResultsFromFixtures(rawFixtures);
}

function parseTeamPayload(team) {

  const rawFixtures = team?.fixtures?.allFixtures?.fixtures;
  const now = Date.now();

  if (Array.isArray(rawFixtures) && rawFixtures.length) {
    const upcoming = rawFixtures
      .filter((raw) => !isFinished(raw))
      .map(normalizeFixture)
      .filter((fixture) => {
        if (!fixture.kickoff) return true;
        return Date.parse(fixture.kickoff) >= now - 3 * 3_600_000;
      })
      .sort((a, b) => {
        const ta = a.kickoff ? Date.parse(a.kickoff) : Number.MAX_SAFE_INTEGER;
        const tb = b.kickoff ? Date.parse(b.kickoff) : Number.MAX_SAFE_INTEGER;
        return ta - tb;
      })
      .slice(0, 12);

    const results = rawFixtures
      .filter((raw) => isFinished(raw))
      .map(normalizeFixture)
      .sort((a, b) => {
        const ta = a.kickoff ? Date.parse(a.kickoff) : 0;
        const tb = b.kickoff ? Date.parse(b.kickoff) : 0;
        return tb - ta;
      })
      .slice(0, 12);

    return { upcoming, results };
  }

  const next = team?.overview?.nextMatch;
  if (next && !isFinished(next)) {
    return { upcoming: [normalizeFixture(next)], results: [] };
  }

  return { upcoming: [], results: [] };
}

function extractTeamFromHtml(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) {
    throw new Error("FotMob page did not include fixture data");
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
    const response = await httpsFetch(FOTMOB_PAGE, {
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
    const team = extractTeamFromHtml(html);
    const { upcoming, results } = parseTeamPayload(team);
    const rawFixtures = await collectAllRawFixturesAsync(team);
    const leagueResults = parseLeagueResultsFromFixtures(rawFixtures);
    const leagueRecord = summarizeLeagueRecord(rawFixtures);
    const leagueMatchGoals = parseLeagueMatchGoals(rawFixtures);
    const leagueGoalScorers = await loadGoalScorers(team);

    if (!upcoming.length && !results.length && !leagueResults.length) {
      throw new Error("No fixtures found on FotMob page");
    }

    return {
      upcoming,
      results,
      leagueResults,
      leagueRecord,
      leagueMatchGoals,
      leagueGoalScorers,
      source: "fotmob",
    };
  } finally {
    clearTimeout(timer);
  }
}

function clearFixturesCache() {
  cache = { at: 0, data: null };
}

async function getMaccabiFixtures() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }

  const live = await fetchFromFotmob();
  const result = {
    team: TEAM_NAME,
    teamId: TEAM_ID,
    source: live.source,
    sourceUrl: FOTMOB_PAGE,
    fetchedAt: new Date().toISOString(),
    fixtures: live.upcoming,
    results: live.results,
    leagueResults: live.leagueResults,
    leagueRecord: live.leagueRecord || { wins: 0, losses: 0, ties: 0 },
    leagueMatchGoals: live.leagueMatchGoals || [],
    leagueGoalScorers: live.leagueGoalScorers || [],
    nextMatch: live.upcoming[0] || null,
  };
  cache = { at: Date.now(), data: result };
  return result;
}

module.exports = {
  getMaccabiFixtures,
  clearFixturesCache,
  FOTMOB_PAGE,
  parseTeamPayload,
  parseLeagueResultsFromFixtures,
  summarizeLeagueRecord,
  parseLeagueMatchGoals,
  parseAllLeagueResultsAsync,
  extractTeamFromHtml,
};
