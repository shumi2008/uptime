// Followed teams. Add an entry here to make it selectable in the UI.
const TEAMS = {
  "maccabi-haifa": {
    slug: "maccabi-haifa",
    id: 10185,
    name: "Maccabi Haifa",
    shortName: "Haifa",
    fotmobSlug: "maccabi-haifa",
    leagueId: 127,
    leagueNamePattern: "ligat ha",
    leagueLabel: "Ligat ha'Al",
    historyDivisionPattern: /leumit|ligat|premier|israeli league|israeli premier/i,
    historyFile: "haifa-league-positions.json",
    founded: 1913,
    wikiSeasonsUrl: "https://en.wikipedia.org/wiki/List_of_Maccabi_Haifa_F.C._seasons",
    color: "#22b890",
    map: { lat: 31.75, lng: 34.85, zoom: 8, country: "Israel" },
  },
  "aek-athens": {
    slug: "aek-athens",
    id: 8563,
    name: "AEK Athens",
    shortName: "AEK",
    fotmobSlug: "aek-athens",
    leagueId: 135,
    leagueNamePattern: "super league",
    leagueLabel: "Super League",
    historyDivisionPattern: /super league|alpha ethniki|greek|a' ethniki|a ethniki/i,
    historyFile: "aek-league-positions.json",
    founded: 1924,
    wikiSeasonsUrl: "https://en.wikipedia.org/wiki/List_of_AEK_Athens_F.C._seasons",
    color: "#f5c518",
    map: { lat: 38.6, lng: 23.3, zoom: 7, country: "Greece" },
  },
};

const DEFAULT_TEAM = "maccabi-haifa";

function getTeam(slug) {
  return TEAMS[slug || DEFAULT_TEAM] || null;
}

function publicTeams() {
  return Object.values(TEAMS).map((t) => ({
    slug: t.slug,
    id: t.id,
    name: t.name,
    shortName: t.shortName,
    leagueLabel: t.leagueLabel,
    color: t.color,
    map: t.map,
    logo: `https://images.fotmob.com/image_resources/logo/teamlogo/${t.id}.png`,
  }));
}

module.exports = { TEAMS, DEFAULT_TEAM, getTeam, publicTeams };
