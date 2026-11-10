const TEAM_CITIES = {
  8173: { city: "Jerusalem", lat: 31.7683, lng: 35.2137 },
  8718: { city: "Sakhnin", lat: 32.8644, lng: 35.297 },
  9754: { city: "Beer Sheva", lat: 31.2529, lng: 34.7915 },
  8301: { city: "Haifa", lat: 32.794, lng: 34.9896 },
  459591: { city: "Jerusalem", lat: 31.7683, lng: 35.2137 },
  9755: { city: "Petah Tikva", lat: 32.0871, lng: 34.8878 },
  89753: { city: "Ramat Gan", lat: 32.0684, lng: 34.8248 },
  10181: { city: "Tel Aviv", lat: 32.0853, lng: 34.7818 },
  2095: { city: "Kiryat Shmona", lat: 33.2079, lng: 35.5701 },
  10185: { city: "Haifa", lat: 32.794, lng: 34.9896 },
  1832: { city: "Netanya", lat: 32.3215, lng: 34.8532 },
  7929: { city: "Petah Tikva", lat: 32.0871, lng: 34.8878 },
  7855: { city: "Tel Aviv", lat: 32.0853, lng: 34.7818 },
  543580: { city: "Tiberias", lat: 32.7951, lng: 35.5308 },
  // Greek Super League
  10200: { city: "Athens", lat: 37.9838, lng: 23.7275 },
  8638: { city: "Piraeus", lat: 37.9427, lng: 23.6469 },
  8563: { city: "Athens", lat: 37.9838, lng: 23.7275 },
  8619: { city: "Thessaloniki", lat: 40.6401, lng: 22.9444 },
  8239: { city: "Thessaloniki", lat: 40.6401, lng: 22.9444 },
  7753: { city: "Heraklion", lat: 35.3387, lng: 25.1442 },
  488099: { city: "Kifisia", lat: 38.0742, lng: 23.8115 },
  1585: { city: "Kalamata", lat: 37.0389, lng: 22.1142 },
  8675: { city: "Thessaloniki", lat: 40.6401, lng: 22.9444 },
  162386: { city: "Agrinio", lat: 38.6214, lng: 21.4079 },
  80654: { city: "Tripoli", lat: 37.5089, lng: 22.3713 },
  10187: { city: "Athens", lat: 37.9838, lng: 23.7275 },
  4493: { city: "Livadeia", lat: 38.4363, lng: 22.8742 },
  885256: { city: "Volos", lat: 39.3666, lng: 22.9507 },
};

const TEAM_NAME_CITIES = {
  "beitar jerusalem": TEAM_CITIES[8173],
  "bnei sakhnin": TEAM_CITIES[8718],
  "hapoel beer sheva": TEAM_CITIES[9754],
  "hapoel haifa": TEAM_CITIES[8301],
  "hapoel jerusalem fc": TEAM_CITIES[459591],
  "hapoel jerusalem": TEAM_CITIES[459591],
  "hapoel petah tikva": TEAM_CITIES[9755],
  "hapoel ramat gan": TEAM_CITIES[89753],
  "hapoel tel aviv": TEAM_CITIES[10181],
  "hapoel ironi kiryat shmona": TEAM_CITIES[2095],
  "maccabi haifa": TEAM_CITIES[10185],
  "maccabi netanya": TEAM_CITIES[1832],
  "maccabi petach tikva": TEAM_CITIES[7929],
  "maccabi tel aviv": TEAM_CITIES[7855],
  "ironi tiberias": TEAM_CITIES[543580],
};

function getTeamCity(teamId, teamName) {
  if (TEAM_CITIES[teamId]) {
    return TEAM_CITIES[teamId];
  }

  const key = String(teamName || "")
    .trim()
    .toLowerCase();
  return TEAM_NAME_CITIES[key] || null;
}

function buildCityHeatmap(rows) {
  const byCity = new Map();

  for (const row of rows || []) {
    const location = getTeamCity(row.id, row.name);
    if (!location) continue;

    const points = Math.max(0, Number(row.points) || 0);
    const existing = byCity.get(location.city);

    if (existing) {
      existing.points += points;
      existing.teams.push({
        id: row.id,
        name: row.name,
        points: row.points,
        rank: row.rank,
      });
    } else {
      byCity.set(location.city, {
        city: location.city,
        lat: location.lat,
        lng: location.lng,
        points,
        teams: [
          {
            id: row.id,
            name: row.name,
            points: row.points,
            rank: row.rank,
          },
        ],
      });
    }
  }

  const cities = Array.from(byCity.values());
  const maxPoints = Math.max(1, ...cities.map((city) => city.points));

  return cities.map((city) => ({
    ...city,
    intensity: Math.max(0.2, city.points / maxPoints),
  }));
}

module.exports = {
  TEAM_CITIES,
  getTeamCity,
  buildCityHeatmap,
};
