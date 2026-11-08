const { httpsFetch } = require("./https-fetch");

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
  return false;
}

const FOTMOB_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml",
  "Accept-Language": "en-US,en;q=0.9",
};

const LEAGUE_TABLE_PAGES = {
  47: "https://www.fotmob.com/leagues/47/table/premier-league",
  53: "https://www.fotmob.com/leagues/53/table/ligue-1",
  54: "https://www.fotmob.com/leagues/54/table/bundesliga",
  55: "https://www.fotmob.com/leagues/55/table/serie-a",
  87: "https://www.fotmob.com/leagues/87/table/laliga",
  127: "https://www.fotmob.com/leagues/127/table/ligat-haal",
  130: "https://www.fotmob.com/leagues/130/table/mls",
};

const LEAGUE_IDS_BY_COUNTRY = {
  CA: [130],
  US: [130],
  IL: [127],
  GB: [47],
  UK: [47],
  ES: [87],
  DE: [54],
  IT: [55],
  FR: [53],
};

const CACHE_MS = 6 * 60 * 60 * 1000;
const htmlCache = new Map();
const teamCache = new Map();

function teamLogoUrl(id) {
  if (!id) return null;
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
}

function citySlug(city) {
  return normalizePlaceName(city).replace(/\s+/g, "-");
}

function extractTeamLinksFromHtml(html) {
  const re = /\/teams\/(\d+)\/overview\/([a-z0-9-]+)/g;
  const byId = new Map();
  let match;
  while ((match = re.exec(html))) {
    byId.set(Number(match[1]), {
      id: Number(match[1]),
      slug: match[2],
    });
  }
  return [...byId.values()];
}

function linkMatchesPlace(link, { city, area }) {
  const slug = normalizePlaceName(link.slug).replace(/-/g, " ");
  const candidates = city ? [city] : [area].filter(Boolean);
  for (const candidate of candidates) {
    const normalized = normalizePlaceName(candidate);
    if (!normalized) continue;
    if (slug.includes(normalized) || normalized.includes(slug)) return true;
    if (placeNamesMatch(slug, candidate)) return true;
    if (normalizePlaceName(link.slug).includes(citySlug(candidate))) return true;
  }
  return false;
}

function extractNextDataTeam(html, teamId) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) return null;
  const payload = JSON.parse(match[1]);
  return payload?.props?.pageProps?.fallback?.[`team-${teamId}`] || null;
}

function findTeamRank(teamPayload, teamId) {
  const blocks = [
    teamPayload?.overview?.table,
    teamPayload?.table,
  ].filter(Array.isArray);

  for (const block of blocks) {
    for (const entry of block) {
      const tables = entry?.data?.tables || [];
      for (const table of tables) {
        const rows = table?.table?.all || entry?.data?.table?.all || [];
        for (const row of rows) {
          if (Number(row?.id) === Number(teamId) && Number.isFinite(row?.idx)) {
            return row.idx;
          }
        }
      }
      const rows = entry?.data?.table?.all || [];
      for (const row of rows) {
        if (Number(row?.id) === Number(teamId) && Number.isFinite(row?.idx)) {
          return row.idx;
        }
      }
    }
  }
  return null;
}

function findLeagueName(teamPayload) {
  const block = teamPayload?.overview?.table?.[0]?.data || teamPayload?.table?.[0]?.data;
  return block?.leagueName || null;
}

function stadiumCityFromTeam(teamPayload) {
  const faq = teamPayload?.details?.faqJSONLD?.mainEntity;
  if (Array.isArray(faq)) {
    for (const item of faq) {
      const text = item?.acceptedAnswer?.text || "";
      const located = text.match(/located in ([^.]+)/i);
      if (located?.[1]) return located[1].trim();
    }
  }
  return null;
}

function stadiumMatchesPlace(stadiumText, place) {
  if (!stadiumText) return true;
  for (const candidate of [place.city, place.area].filter(Boolean)) {
    if (placeNamesMatch(stadiumText, candidate)) return true;
    if (normalizePlaceName(stadiumText).includes(normalizePlaceName(candidate))) {
      return true;
    }
  }
  return false;
}

async function fetchLeagueTableHtml(leagueId) {
  const url = LEAGUE_TABLE_PAGES[leagueId];
  if (!url) return null;

  const cached = htmlCache.get(leagueId);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.html;
  }

  const response = await httpsFetch(url, { headers: FOTMOB_HEADERS });
  if (!response.ok) {
    throw new Error(`FotMob league ${leagueId} HTTP ${response.status}`);
  }
  const html = await response.text();
  htmlCache.set(leagueId, { at: Date.now(), html });
  return html;
}

async function fetchFotmobTeamProfile(link) {
  const cacheKey = `${link.id}:${link.slug}`;
  const cached = teamCache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return cached.data;
  }

  const url = `https://www.fotmob.com/teams/${link.id}/overview/${link.slug}`;
  const response = await httpsFetch(url, { headers: FOTMOB_HEADERS });
  if (!response.ok) {
    throw new Error(`FotMob team HTTP ${response.status}`);
  }
  const html = await response.text();
  const teamPayload = extractNextDataTeam(html, link.id);
  const details = teamPayload?.details;
  if (!details?.id) return null;

  const profile = {
    id: details.id,
    name: details.name || details.shortName,
    logo: teamLogoUrl(details.id),
    league: findLeagueName(teamPayload) || "FotMob league",
    rank: findTeamRank(teamPayload, details.id),
    city: stadiumCityFromTeam(teamPayload),
    source: "fotmob",
    url: url.replace("https://www.fotmob.com", ""),
  };

  teamCache.set(cacheKey, { at: Date.now(), data: profile });
  return profile;
}

function leagueIdsForPlace(place) {
  const code = String(place.countryCode || "").toUpperCase();
  const ids = new Set(LEAGUE_IDS_BY_COUNTRY[code] || []);

  if (placeNamesMatch(place.country, "Canada") || code === "CA") {
    ids.add(130);
  }
  if (placeNamesMatch(place.country, "United States") || code === "US") {
    ids.add(130);
  }
  if (placeNamesMatch(place.country, "Israel") || code === "IL") {
    ids.add(127);
  }

  return [...ids];
}

async function findFromFotmobLeagues(place) {
  if (!place.city && !place.area) return [];

  const leagueIds = leagueIdsForPlace(place);
  if (!leagueIds.length) return [];

  const links = [];
  for (const leagueId of leagueIds) {
    try {
      const html = await fetchLeagueTableHtml(leagueId);
      if (!html) continue;
      for (const link of extractTeamLinksFromHtml(html)) {
        if (linkMatchesPlace(link, place)) {
          links.push(link);
        }
      }
    } catch {
      // try next league table
    }
  }

  const unique = new Map();
  for (const link of links) {
    unique.set(link.id, link);
  }

  const teams = [];
  for (const link of unique.values()) {
    try {
      const profile = await fetchFotmobTeamProfile(link);
      if (!profile) continue;
      if (!stadiumMatchesPlace(profile.city, place) && !linkMatchesPlace(link, place)) {
        continue;
      }
      teams.push(profile);
    } catch {
      // skip team if profile fetch fails
    }
  }

  return teams.sort((a, b) => {
    const rankA = Number(a.rank);
    const rankB = Number(b.rank);
    if (Number.isFinite(rankA) && Number.isFinite(rankB)) return rankA - rankB;
    if (Number.isFinite(rankA)) return -1;
    if (Number.isFinite(rankB)) return 1;
    return String(a.name).localeCompare(String(b.name));
  });
}

module.exports = {
  findFromFotmobLeagues,
  extractTeamLinksFromHtml,
};
