const { getMaccabiTable } = require("../table");
const { httpsFetch } = require("./https-fetch");
const { findFromFotmobLeagues } = require("./fotmob-location-teams");

const SPORTS_DB = "https://www.thesportsdb.com/api/v1/json/3";
const CACHE_MS = 6 * 60 * 60 * 1000;
const MAX_TEAMS = 16;
const MAX_SOCCER_LEAGUES = 6;

const leagueCache = new Map();
const leagueTeamsCache = new Map();

function normalizePlaceName(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[''`-]/g, "")
    .replace(/\s+/g, " ");
}

function placeNamesMatch(a, b) {
  const left = normalizePlaceName(a);
  const right = normalizePlaceName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;

  const pairs = [
    ["petah tikva", "petach tikva"],
    ["beer sheva", "be er sheva"],
    ["beersheva", "beer sheva"],
    ["tel aviv", "tel aviv yafo"],
    ["kiryat shmona", "kiryat shemona"],
    ["united states", "usa"],
    ["united kingdom", "england"],
  ];

  return pairs.some(
    ([one, two]) =>
      (left.includes(one) && right.includes(two)) ||
      (left.includes(two) && right.includes(one))
  );
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return earthKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function teamKey(team) {
  return normalizePlaceName(team.name);
}

function dedupeTeams(teams) {
  const seen = new Set();
  const out = [];
  for (const team of teams) {
    const key = teamKey(team);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(team);
    if (out.length >= MAX_TEAMS) break;
  }
  return out;
}

function countrySearchNames(country, countryCode) {
  const names = [];
  const code = countryCode ? String(countryCode).toUpperCase() : "";
  if (country) names.push(country);
  if (code) {
    const byCode = {
      IL: "Israel",
      GB: "England",
      UK: "England",
      US: "United States",
      ES: "Spain",
      DE: "Germany",
      FR: "France",
      IT: "Italy",
      PT: "Portugal",
      NL: "Netherlands",
      BE: "Belgium",
      TR: "Turkey",
      GR: "Greece",
      BR: "Brazil",
      AR: "Argentina",
      CA: "Canada",
    };
    if (byCode[code]) names.push(byCode[code]);
  }
  if (placeNamesMatch(country, "United States") || code === "US") {
    names.push("United States");
  }
  if (placeNamesMatch(country, "Canada") || code === "CA") {
    names.push("Canada");
    names.push("United States");
  }

  return [...new Set(names.filter(Boolean))];
}

function locationMatchesPlace(strLocation, { city, area, country }) {
  if (!strLocation) return false;
  const raw = String(strLocation);
  const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const primary = parts[0] || raw;

  if (country && parts.length > 1) {
    const locationCountry = parts[parts.length - 1];
    if (
      !placeNamesMatch(country, locationCountry) &&
      !normalizePlaceName(raw).includes(normalizePlaceName(country))
    ) {
      return false;
    }
  }

  const candidates = city ? [city] : [area].filter(Boolean);
  for (const candidate of candidates) {
    if (placeNamesMatch(primary, candidate)) return true;
    if (placeNamesMatch(raw, candidate)) return true;
  }

  return false;
}

async function fetchJson(url) {
  const response = await httpsFetch(url, {
    headers: {
      "User-Agent": "uptime-app/1.0 (location football clubs)",
      Accept: "application/json",
    },
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

function cacheGet(map, key) {
  const hit = map.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_MS) {
    map.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(map, key, data) {
  map.set(key, { at: Date.now(), data });
}

async function fetchSportsDbLeagues(countryName) {
  const cacheKey = normalizePlaceName(countryName);
  const cached = cacheGet(leagueCache, cacheKey);
  if (cached) return cached;

  const url = `${SPORTS_DB}/search_all_leagues.php?c=${encodeURIComponent(countryName)}`;
  const payload = await fetchJson(url);
  const leagues = Array.isArray(payload?.countries)
    ? payload.countries
    : Array.isArray(payload?.leagues)
      ? payload.leagues
      : [];

  cacheSet(leagueCache, cacheKey, leagues);
  return leagues;
}

async function fetchSportsDbTeamsForLeague(leagueName) {
  const cacheKey = normalizePlaceName(leagueName);
  const cached = cacheGet(leagueTeamsCache, cacheKey);
  if (cached) return cached;

  const url = `${SPORTS_DB}/search_all_teams.php?l=${encodeURIComponent(leagueName)}`;
  const payload = await fetchJson(url);
  const teams = Array.isArray(payload?.teams) ? payload.teams : [];
  cacheSet(leagueTeamsCache, cacheKey, teams);
  return teams;
}

function normalizeTableTeam(row, leagueName) {
  return {
    id: row.id,
    name: row.name,
    logo:
      row.logo ||
      (row.id
        ? `https://images.fotmob.com/image_resources/logo/teamlogo/${row.id}.png`
        : null),
    league: leagueName || "Ligat ha'Al",
    rank: row.rank,
    city: row.city,
    source: "fotmob",
  };
}

async function findFromLeagueTable(place) {
  const data = await getMaccabiTable();
  const rows = (data.rows || []).filter((row) => row.lat != null && row.lng != null);
  if (!rows.length) return [];

  const { city, area, lat, lng, country, countryCode } = place;
  const inIsrael =
    placeNamesMatch(country, "Israel") ||
    String(countryCode || "").toUpperCase() === "IL";

  if (!inIsrael) return [];

  const candidates = [city, area].filter(Boolean);
  for (const candidate of candidates) {
    const matches = rows.filter(
      (row) => row.city && placeNamesMatch(row.city, candidate)
    );
    if (matches.length) {
      return matches.map((row) => normalizeTableTeam(row, data.leagueName));
    }
  }

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [];

  let nearest = null;
  let nearestDistance = Infinity;
  for (const row of rows) {
    const distance = distanceKm(lat, lng, row.lat, row.lng);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = row;
    }
  }

  if (!nearest || nearestDistance > 40) return [];

  return rows
    .filter((row) => row.city && row.city === nearest.city)
    .map((row) => normalizeTableTeam(row, data.leagueName));
}

async function findFromSportsDb(place) {
  const names = countrySearchNames(place.country, place.countryCode);
  if (!names.length) return [];

  let leagues = [];
  for (const name of names) {
    try {
      const found = await fetchSportsDbLeagues(name);
      if (found.length) {
        leagues = found;
        break;
      }
    } catch {
      // try next country alias
    }
  }

  if (!leagues.length) return [];

  const soccerLeagues = leagues
    .filter((league) => String(league.strSport || "").toLowerCase() === "soccer")
    .slice(0, MAX_SOCCER_LEAGUES);

  const extraLeagueNames = [];
  if (
    placeNamesMatch(place.country, "Canada") ||
    String(place.countryCode || "").toUpperCase() === "CA" ||
    placeNamesMatch(place.country, "United States") ||
    String(place.countryCode || "").toUpperCase() === "US"
  ) {
    extraLeagueNames.push("American Major League Soccer");
  }

  const matched = [];

  for (const league of soccerLeagues) {
    let teams = [];
    try {
      teams = await fetchSportsDbTeamsForLeague(league.strLeague);
    } catch {
      continue;
    }

    for (const team of teams) {
      if (!locationMatchesPlace(team.strLocation, place)) continue;
      matched.push({
        id: team.idTeam,
        name: team.strTeam,
        logo: team.strTeamBadge || team.strBadge || null,
        league: team.strLeague || league.strLeague,
        rank: null,
        city: team.strLocation || null,
        source: "thesportsdb",
      });
    }
  }

  for (const leagueName of extraLeagueNames) {
    let teams = [];
    try {
      teams = await fetchSportsDbTeamsForLeague(leagueName);
    } catch {
      continue;
    }
    for (const team of teams) {
      if (!locationMatchesPlace(team.strLocation, place)) continue;
      matched.push({
        id: team.idTeam,
        name: team.strTeam,
        logo: team.strTeamBadge || team.strBadge || null,
        league: team.strLeague || leagueName,
        rank: null,
        city: team.strLocation || null,
        source: "thesportsdb",
      });
    }
  }

  return matched;
}

function teamRankValue(rank) {
  if (rank == null || rank === "") return null;
  const value = Number(rank);
  return Number.isFinite(value) ? value : null;
}

async function findNearbyFootballTeams(place) {
  const [fromFotmobLeagues, fromTable, fromSportsDb] = await Promise.all([
    findFromFotmobLeagues(place).catch(() => []),
    findFromLeagueTable(place).catch(() => []),
    findFromSportsDb(place).catch(() => []),
  ]);

  const merged = dedupeTeams(
    [...fromFotmobLeagues, ...fromTable, ...fromSportsDb].sort((a, b) => {
      const rankA = teamRankValue(a.rank);
      const rankB = teamRankValue(b.rank);
      if (rankA != null && rankB != null) return rankA - rankB;
      if (rankA != null) return -1;
      if (rankB != null) return 1;
      return a.name.localeCompare(b.name);
    })
  );

  return {
    teams: merged,
    sources: [...new Set(merged.map((team) => team.source))],
  };
}

module.exports = {
  findNearbyFootballTeams,
  placeNamesMatch,
  normalizePlaceName,
};
