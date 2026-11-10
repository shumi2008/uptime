const { getTeam } = require("./teams");

const { httpsFetch } = require("./lib/https-fetch");

const CACHE_MS = 15 * 60 * 1000;
const instances = new Map();

function createSquad(team) {
  const TEAM_ID = team.id;
  const TEAM_NAME = team.name;
  const FOTMOB_SQUAD_PAGE = `https://www.fotmob.com/teams/${TEAM_ID}/squad/${team.fotmobSlug}`;
  let cache = { at: 0, data: null };

const GROUP_LABELS = {
  coach: "Coach",
  keepers: "Goalkeepers",
  defenders: "Defenders",
  midfielders: "Midfielders",
  forwards: "Forwards",
};

const PLAYER_PHOTO_FALLBACK =
  "https://www.fotmob.com/img/player-fallback-light.png";

function playerPhotoUrl(id) {
  if (!id) return PLAYER_PHOTO_FALLBACK;
  return `https://images.fotmob.com/image_resources/playerimages/${id}.png`;
}

function countryFlagUrl(ccode) {
  if (!ccode) return null;
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${String(ccode).toLowerCase()}.png`;
}

function formatHeight(cm) {
  if (cm == null || Number.isNaN(Number(cm))) return null;
  return `${cm} cm`;
}

function formatTransferValue(value) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const amount = Number(value);
  if (amount >= 1_000_000) {
    return `€${(amount / 1_000_000).toFixed(1)}M`;
  }
  if (amount >= 1_000) {
    return `€${Math.round(amount / 1_000)}K`;
  }
  return `€${Math.round(amount)}`;
}

function formatGroupTitle(title) {
  if (!title) return "Squad";
  return GROUP_LABELS[title] || title.charAt(0).toUpperCase() + title.slice(1);
}

function normalizeMember(member) {
  const injury = member.injury
    ? {
        expectedReturn: member.injury.expectedReturn || null,
      }
    : null;

  return {
    id: member.id,
    name: member.name,
    photo: playerPhotoUrl(member.id),
    photoOriginal: PLAYER_PHOTO_FALLBACK,
    shirtNumber: member.shirtNumber ?? null,
    position: member.positionIdsDesc || member.role?.fallback || null,
    role: member.role?.fallback || null,
    country: member.cname || null,
    countryCode: member.ccode || null,
    countryFlag: countryFlagUrl(member.ccode),
    age: member.age ?? null,
    height: formatHeight(member.height),
    transferValue: formatTransferValue(member.transferValue),
    injured: Boolean(member.injured || injury),
    injury,
    goals: Number(member.goals) || 0,
  };
}

function parseSquadPayload(team) {
  const groups = team?.squad?.squad;
  if (!Array.isArray(groups) || !groups.length) {
    return null;
  }

  return groups.map((group) => ({
    title: formatGroupTitle(group.title),
    key: group.title || "squad",
    members: (group.members || []).map(normalizeMember),
  }));
}

function extractTeamFromHtml(html) {
  const match = html.match(
    /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/
  );
  if (!match) {
    throw new Error("FotMob page did not include squad data");
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
    const response = await httpsFetch(FOTMOB_SQUAD_PAGE, {
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
    const groups = parseSquadPayload(extractTeamFromHtml(html));

    if (!groups?.length) {
      throw new Error("No squad found on FotMob page");
    }

    return { groups, source: "fotmob" };
  } finally {
    clearTimeout(timer);
  }
}

async function getSquad() {
  if (cache.data && Date.now() - cache.at < CACHE_MS) {
    return cache.data;
  }

  const live = await fetchFromFotmob();
  const playerCount = live.groups.reduce(
    (total, group) => total + group.members.length,
    0
  );

  const result = {
    team: TEAM_NAME,
    teamId: TEAM_ID,
    source: live.source,
    sourceUrl: FOTMOB_SQUAD_PAGE,
    fetchedAt: new Date().toISOString(),
    groups: live.groups,
    playerCount,
    playerPhotoFallback: PLAYER_PHOTO_FALLBACK,
  };

  cache = { at: Date.now(), data: result };
  return result;
}

return { getSquad, FOTMOB_SQUAD_PAGE, parseSquadPayload, extractTeamFromHtml, normalizeMember, PLAYER_PHOTO_FALLBACK };
}

function forTeam(slug) {
  const team = getTeam(slug);
  if (!team) return null;
  if (!instances.has(team.slug)) instances.set(team.slug, createSquad(team));
  return instances.get(team.slug);
}

const haifa = forTeam("maccabi-haifa");

module.exports = {
  forTeam,
  getSquad: (slug) => forTeam(slug).getSquad(),
  getMaccabiSquad: () => haifa.getSquad(),
  FOTMOB_SQUAD_PAGE: haifa.FOTMOB_SQUAD_PAGE,
  parseSquadPayload: haifa.parseSquadPayload,
  extractTeamFromHtml: haifa.extractTeamFromHtml,
  normalizeMember: haifa.normalizeMember,
  PLAYER_PHOTO_FALLBACK: haifa.PLAYER_PHOTO_FALLBACK,
};
