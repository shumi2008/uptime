const ISRAEL_CENTER = {
  lat: CURRENT_TEAM.map.lat,
  lng: CURRENT_TEAM.map.lng,
  label: CURRENT_TEAM.map.label,
};
const MAP_DEFAULT_ZOOM = CURRENT_TEAM.map.zoom;

const HEATMAP_OPTIONS = {
  radius: 38,
  blur: 24,
  maxZoom: 5,
  minOpacity: 0.35,
};

const IS_AEK = CURRENT_TEAM.slug === "aek-athens";

const HEAT_GRADIENT = IS_AEK
  ? {
      0.0: "#1a1500",
      0.35: "#8a6c00",
      0.7: "#e0b400",
      1.0: "#ffd100",
    }
  : {
      0.0: "#0c1a1f",
      0.35: "#0d6b52",
      0.7: "#1a9b7a",
      1.0: "#22b890",
    };

const CITY_MARKER_STYLE = IS_AEK
  ? { color: "#ffd100", fillColor: "#e0b400" }
  : { color: "#22b890", fillColor: "#1a9b7a" };

const DARK_BASEMAP = {
  url: "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",
  options: {
    attribution: "Tiles &copy; Esri",
    maxZoom: 16,
  },
};

let mapInstance = null;
let heatLayer = null;
let rankHeatLayers = [];
let cityMarkers = null;
let userLocationMarker = null;
let leagueStatusMessage = "";
let userLocation = null;
let userLocationDetails = null;
let userLocationAccuracy = null;
let userLocationGeocodePromise = null;
let userLocationTeams = null;
let userLocationTeamsPromise = null;
let leagueCities = null;
let leagueRows = null;
let haifaLeagueResults = null;
let mapMode = "heatmap";
let leagueName = "";

const RESULT_COLORS = {
  win: "#22c55e",
  loss: "#ef4444",
};

let resultsPieChart = null;
let goalsLineChart = null;

/** Matches monthly uptime / FotMob latency charts in app.js */
const MAP_CHART_COLORS = {
  muted: "#4a6360",
  grid: "rgba(12, 26, 31, 0.08)",
  line: "#1a9b7a",
  fill: "rgba(26, 155, 122, 0.16)",
  lineConceded: "#8a3b2b",
  fillConceded: "rgba(138, 59, 43, 0.14)",
};

const USER_LOCATION_ZOOM = 13;
const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 12_000,
  maximumAge: 60_000,
};

function toHeatLayerData(cities) {
  return cities.map((city) => [city.lat, city.lng, city.intensity]);
}

const HAIFA_TEAM_ID = CURRENT_TEAM.id;
const RANK_HEAT_COLOR_HAIFA = CURRENT_TEAM.color;
const RANK_HEAT_COLOR_OTHER = "#6366f1";

function isMaccabiHaifaTeam(team) {
  const id = Number(team?.id);
  if (id === HAIFA_TEAM_ID) return true;
  const name = String(team?.name || "")
    .trim()
    .toLowerCase();
  return name === CURRENT_TEAM.name.toLowerCase();
}

function getRankTeamHeatColor(team) {
  return isMaccabiHaifaTeam(team) ? RANK_HEAT_COLOR_HAIFA : RANK_HEAT_COLOR_OTHER;
}

function getRankIntensity(rank, totalTeams) {
  if (rank > 6) return 0.1;
  const topCount = 6;
  const ratio = (topCount - rank) / Math.max(topCount - 1, 1);
  return 0.22 + ratio * 0.78;
}

function getRankHeatRadius(rank, totalTeams) {
  const ratio = (totalTeams - rank) / Math.max(totalTeams - 1, 1);
  return 30 + ratio * 18;
}

function createRankGradient(color) {
  return {
    0.0: "rgba(12, 26, 31, 0.12)",
    0.35: color,
    0.7: color,
    1.0: color,
  };
}

function setMapStatus(message, isError = false) {
  const statusEl = document.getElementById("map-status");
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.classList.toggle("map-status--error", isError);
}

function ensureMap() {
  const mapEl = document.getElementById("leaflet-map");
  if (!mapEl || typeof L === "undefined" || typeof L.heatLayer !== "function") {
    setMapStatus("Map libraries failed to load.", true);
    return null;
  }

  if (mapInstance) {
    return mapInstance;
  }

  mapInstance = L.map(mapEl, {
    scrollWheelZoom: true,
    preferCanvas: true,
    minZoom: CURRENT_TEAM.map.minZoom,
    maxZoom: 16,
  }).setView([ISRAEL_CENTER.lat, ISRAEL_CENTER.lng], MAP_DEFAULT_ZOOM);

  L.tileLayer(DARK_BASEMAP.url, DARK_BASEMAP.options)
    .on("tileerror", () => {
      setMapStatus("Map tiles failed to load. Check your network connection.", true);
    })
    .addTo(mapInstance);

  window.setTimeout(() => mapInstance.invalidateSize(), 0);
  window.setTimeout(() => mapInstance.invalidateSize(), 250);

  if (!mapInstance._heatZoomBound) {
    mapInstance.on("zoomend", () => {
      if (mapMode === "heatmap") {
        heatLayer?.redraw();
      } else if (mapMode === "rankings") {
        rankHeatLayers.forEach((layer) => layer.redraw());
      }
    });
    mapInstance._heatZoomBound = true;
  }

  return mapInstance;
}

function createHeatLayer(cities) {
  return L.heatLayer(toHeatLayerData(cities), {
    radius: HEATMAP_OPTIONS.radius,
    blur: HEATMAP_OPTIONS.blur,
    maxZoom: HEATMAP_OPTIONS.maxZoom,
    minOpacity: HEATMAP_OPTIONS.minOpacity,
    gradient: HEAT_GRADIENT,
  });
}

function formatCityPopup(city) {
  const teamLines = city.teams
    .map((team) => `${team.name} (${team.points} pts)`)
    .join("<br>");
  return `<strong>${city.city}</strong><br>${teamLines}<br><em>${city.points} total pts</em>`;
}

function formatTeamPopup(team) {
  return `<strong>#${team.rank} ${team.name}</strong><br>${team.city} · ${team.points} pts`;
}

function clearCityMarkers() {
  if (!cityMarkers || !mapInstance) return;
  cityMarkers.forEach((marker) => mapInstance.removeLayer(marker));
  cityMarkers = null;
}

function removeHeatLayer() {
  if (heatLayer && mapInstance) {
    mapInstance.removeLayer(heatLayer);
    heatLayer = null;
  }
}

function clearRankHeatLayers() {
  if (!mapInstance) return;
  rankHeatLayers.forEach((layer) => mapInstance.removeLayer(layer));
  rankHeatLayers = [];
}

function removeAllHeatLayers() {
  removeHeatLayer();
  clearRankHeatLayers();
}

function addCityMarkers(map, cities) {
  clearCityMarkers();
  cityMarkers = cities.map((city) =>
    L.circleMarker([city.lat, city.lng], {
      radius: 5,
      color: CITY_MARKER_STYLE.color,
      weight: 1,
      fillColor: CITY_MARKER_STYLE.fillColor,
      fillOpacity: 0.85,
    })
      .bindPopup(formatCityPopup(city))
      .addTo(map)
  );
}

function offsetTeamPosition(lat, lng, index, total) {
  if (total <= 1) {
    return { lat, lng };
  }

  const angle = (2 * Math.PI * index) / total;
  const radius = 0.012;
  return {
    lat: lat + radius * Math.cos(angle),
    lng: lng + radius * Math.sin(angle),
  };
}

function buildRankedTeams(rows) {
  const byCity = new Map();

  for (const row of rows || []) {
    if (row.lat == null || row.lng == null) continue;

    const key = row.city || `${row.lat},${row.lng}`;
    if (!byCity.has(key)) {
      byCity.set(key, []);
    }
    byCity.get(key).push(row);
  }

  const teams = [];
  for (const cityTeams of byCity.values()) {
    cityTeams
      .sort((a, b) => a.rank - b.rank)
      .forEach((team, index) => {
        const position = offsetTeamPosition(team.lat, team.lng, index, cityTeams.length);
        teams.push({
          ...team,
          displayLat: position.lat,
          displayLng: position.lng,
        });
      });
  }

  return teams.sort((a, b) => a.rank - b.rank);
}

function heatColorFromIntensity(intensity) {
  const t = Math.min(1, Math.max(0, intensity));
  if (t <= 0.35) return HEAT_GRADIENT[0.35];
  if (t <= 0.7) return HEAT_GRADIENT[0.7];
  return HEAT_GRADIENT[1.0];
}

function setMapLegendLayout(mode) {
  const legendEl = document.getElementById("map-rank-legend");
  if (!legendEl) return;
  legendEl.classList.toggle("map-rank-legend--location", mode === "location");
}

function renderHeatmapLegend(cities) {
  const legendEl = document.getElementById("map-rank-legend");
  if (!legendEl) return;
  setMapLegendLayout("scroll");

  if (!cities?.length) {
    legendEl.innerHTML = `<p class="map-rank-legend__title">Cities heatmap</p>
      <p class="map-rank-legend__placeholder">No city data yet.</p>`;
    return;
  }

  const sorted = [...cities].sort((a, b) => b.points - a.points);
  const items = sorted
    .map((city) => {
      const color = heatColorFromIntensity(city.intensity);
      const teamNames = city.teams.map((team) => team.name).join(", ");
      return `<li class="map-rank-legend__item">
        <span class="map-rank-legend__swatch" style="background:${color}"></span>
        <span class="map-rank-legend__rank">${city.points} pts</span>
        <span class="map-rank-legend__name">${city.city}${teamNames ? ` · ${teamNames}` : ""}</span>
        <span class="map-rank-legend__heat">${Math.round(city.intensity * 100)}% heat</span>
      </li>`;
    })
    .join("");

  legendEl.innerHTML = `<p class="map-rank-legend__title">Cities heatmap (glow intensity by league points)</p>
    <ul class="map-rank-legend__list">${items}</ul>`;
}

function formatGpsCoordinates(lat, lng) {
  return `${Number(lat).toFixed(5)}°, ${Number(lng).toFixed(5)}°`;
}

function escapeMapHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
}

function teamLogoUrl(id) {
  if (!id) return null;
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
}

async function fetchNearbyFootballTeams(place) {
  const params = new URLSearchParams();
  if (Number.isFinite(place.lat)) params.set("lat", String(place.lat));
  if (Number.isFinite(place.lng)) params.set("lng", String(place.lng));
  if (place.city) params.set("city", place.city);
  if (place.area) params.set("area", place.area);
  if (place.country) params.set("country", place.country);
  if (place.countryCode) params.set("countryCode", place.countryCode);

  const response = await fetch(`/api/location/nearby-teams?${params.toString()}`, {
    credentials: "same-origin",
  });
  if (!response.ok) return [];
  const data = await response.json();
  return Array.isArray(data.teams) ? data.teams : [];
}

async function ensureUserLocationTeams(place) {
  if (
    userLocationTeams &&
    userLocationDetails &&
    userLocationDetails.lat === place.lat &&
    userLocationDetails.lng === place.lng
  ) {
    return userLocationTeams;
  }

  if (!userLocationTeamsPromise) {
    userLocationTeamsPromise = fetchNearbyFootballTeams(place).finally(() => {
      userLocationTeamsPromise = null;
    });
  }

  userLocationTeams = await userLocationTeamsPromise;
  return userLocationTeams;
}

function renderLocationTeamsBlock(teams) {
  if (!teams?.length) {
    return `<p class="map-rank-legend__placeholder">No football clubs found for this city and country yet.</p>`;
  }

  const items = teams
    .map((team) => {
      const logo = team.logo || teamLogoUrl(team.id);
      const name = escapeMapHtml(team.name);
      const rank = Number(team.rank);
      const meta = Number.isFinite(rank)
        ? `#${rank}`
        : escapeMapHtml(team.league || "");
      return `<li class="map-rank-legend__team">
        <img
          class="map-rank-legend__team-logo"
          src="${escapeMapHtml(logo)}"
          alt="${name} logo"
          width="36"
          height="36"
          loading="lazy"
          decoding="async"
        />
        <span class="map-rank-legend__team-name">${name}</span>
        ${meta ? `<span class="map-rank-legend__team-rank">${meta}</span>` : ""}
      </li>`;
    })
    .join("");

  return `<div class="map-rank-legend__teams">
    <p class="map-rank-legend__teams-heading">Football clubs in this area</p>
    <ul class="map-rank-legend__team-list">${items}</ul>
  </div>`;
}

function renderLocationLegend({
  lat,
  lng,
  city = null,
  area = null,
  country = null,
  accuracy = null,
  loading = false,
  note = null,
  localTeams = [],
} = {}) {
  const legendEl = document.getElementById("map-rank-legend");
  if (!legendEl) return;
  setMapLegendLayout("location");

  if (loading) {
    legendEl.innerHTML = `<p class="map-rank-legend__title">Your location</p>
      <p class="map-rank-legend__placeholder">Looking up city, country, and nearby clubs…</p>`;
    return;
  }

  const detailParts = [
    `GPS coordinates ${formatGpsCoordinates(lat, lng)}`,
    `City ${escapeMapHtml(city || "Unknown")}`,
    `Area ${escapeMapHtml(area || "Unknown")}`,
    `Country ${escapeMapHtml(country || "Unknown")}`,
  ];
  if (accuracy != null && Number.isFinite(accuracy)) {
    detailParts.push(`GPS accuracy ±${Math.round(accuracy)} m`);
  }
  const locationLine = detailParts.join(" · ");

  const teamsBlock = renderLocationTeamsBlock(localTeams);

  legendEl.innerHTML = `<p class="map-rank-legend__title">Your location</p>
    ${note ? `<p class="map-rank-legend__placeholder">${escapeMapHtml(note)}</p>` : ""}
    <p class="map-rank-legend__location-line">${locationLine}</p>
    ${teamsBlock}`;
}

async function fetchUserLocationDetails(lat, lng) {
  const response = await fetch(
    `/api/geocode/reverse?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}`,
    { credentials: "same-origin" }
  );
  if (!response.ok) {
    throw new Error("Reverse geocoding failed");
  }
  return response.json();
}

function updateUserLocationMarkerPopup() {
  if (!userLocationMarker || !userLocation) return;

  const { lat, lng } = userLocation;
  const place = userLocationDetails;
  const lines = [`<strong>Your location</strong>`, formatGpsCoordinates(lat, lng)];

  if (place?.city || place?.area || place?.country) {
    lines.push(
      [place.city, place.area, place.country].filter(Boolean).join(", ") || "Unknown place"
    );
  }

  if (userLocationTeams?.length) {
    lines.push(
      userLocationTeams
        .map((team) => {
          const rank = Number(team.rank);
          return Number.isFinite(rank) ? `#${rank} ${team.name}` : team.name;
        })
        .join(" · ")
    );
  }

  if (userLocationAccuracy != null && Number.isFinite(userLocationAccuracy)) {
    lines.push(`±${Math.round(userLocationAccuracy)} m accuracy`);
  }

  userLocationMarker.setPopupContent(lines.join("<br>"));
}

async function refreshUserLocationLegend() {
  if (!userLocation) {
    renderLocationLegend({
      lat: 0,
      lng: 0,
      note: "Allow location access, then tap Location again.",
    });
    return;
  }

  const { lat, lng } = userLocation;

  function placeFromDetails(details = {}) {
    return {
      lat,
      lng,
      city: details.city,
      area: details.area,
      country: details.country,
      countryCode: details.countryCode,
    };
  }

  async function paintLegend(details, { note = null } = {}) {
    const teams = await ensureUserLocationTeams(placeFromDetails(details));
    if (
      mapMode !== "location" ||
      !userLocation ||
      userLocation.lat !== lat ||
      userLocation.lng !== lng
    ) {
      return;
    }

    renderLocationLegend({
      lat,
      lng,
      city: details.city,
      area: details.area,
      country: details.country,
      accuracy: userLocationAccuracy,
      localTeams: teams,
      note,
    });
    updateUserLocationMarkerPopup();
  }

  const cached =
    userLocationDetails &&
    userLocationDetails.lat === lat &&
    userLocationDetails.lng === lng;

  if (cached) {
    await paintLegend(userLocationDetails);
    return;
  }

  renderLocationLegend({ lat, lng, loading: true });

  if (!userLocationGeocodePromise) {
    userLocationGeocodePromise = fetchUserLocationDetails(lat, lng)
      .then((details) => {
        userLocationDetails = { ...details, lat, lng };
        return userLocationDetails;
      })
      .finally(() => {
        userLocationGeocodePromise = null;
      });
  }

  try {
    const details = await userLocationGeocodePromise;
    await paintLegend(details);
  } catch {
    if (mapMode !== "location") return;
    await paintLegend(
      { city: null, area: null, country: null, countryCode: null },
      {
        note: "Place names could not be loaded; coordinates are from your device GPS.",
      }
    );
  }
}

function renderRankLegend(teams) {
  const legendEl = document.getElementById("map-rank-legend");
  if (!legendEl) return;
  setMapLegendLayout("scroll");

  if (!teams.length) {
    legendEl.innerHTML = `<p class="map-rank-legend__title">Ranking colours</p>
      <p class="map-rank-legend__placeholder">No ranking data yet.</p>`;
    return;
  }

  const totalTeams = teams.length;
  const items = teams
    .map((team) => {
      const color = getRankTeamHeatColor(team);
      const intensity = getRankIntensity(team.rank, totalTeams);
      return `<li class="map-rank-legend__item">
        <span class="map-rank-legend__swatch" style="background:${color}"></span>
        <span class="map-rank-legend__rank">#${team.rank}</span>
        <span class="map-rank-legend__name">${team.name}</span>
        <span class="map-rank-legend__heat">${Math.round(intensity * 100)}% heat</span>
      </li>`;
    })
    .join("");

  legendEl.innerHTML = `<p class="map-rank-legend__title">Ranking colours — ${CURRENT_TEAM.name} highlighted; other teams indigo</p>
    <ul class="map-rank-legend__list">${items}</ul>`;
}

function formatResultPopup(result) {
  const label = result.outcome === "win" ? "Win" : "Loss";
  return `<strong>${label}</strong> vs ${result.opponent}<br>${result.scoreLabel} · ${result.city}<br>${result.kickoffLabel}`;
}

function buildPositionedResults(results) {
  const byVenue = new Map();

  for (const result of results || []) {
    const key = `${result.lat},${result.lng}`;
    if (!byVenue.has(key)) {
      byVenue.set(key, []);
    }
    byVenue.get(key).push(result);
  }

  const positioned = [];
  for (const venueResults of byVenue.values()) {
    venueResults
      .sort((a, b) => Date.parse(a.kickoff || 0) - Date.parse(b.kickoff || 0))
      .forEach((result, index) => {
        const position = offsetTeamPosition(
          result.lat,
          result.lng,
          index,
          venueResults.length
        );
        positioned.push({
          ...result,
          displayLat: position.lat,
          displayLng: position.lng,
        });
      });
  }

  return positioned.sort(
    (a, b) => Date.parse(a.kickoff || 0) - Date.parse(b.kickoff || 0)
  );
}

function renderResultsLegend(results) {
  const legendEl = document.getElementById("map-rank-legend");
  if (!legendEl) return;
  setMapLegendLayout("scroll");

  const wins = results.filter((result) => result.outcome === "win").length;
  const losses = results.filter((result) => result.outcome === "loss").length;

  const items = results
    .map((result) => {
      const color = RESULT_COLORS[result.outcome];
      const label = result.outcome === "win" ? "W" : "L";
      return `<li class="map-rank-legend__item">
        <span class="map-rank-legend__swatch" style="background:${color}"></span>
        <span class="map-rank-legend__rank">${label}</span>
        <span class="map-rank-legend__name">${result.scoreLabel} vs ${result.opponent}</span>
        <span class="map-rank-legend__heat">${result.city}</span>
      </li>`;
    })
    .join("");

  legendEl.innerHTML = `<p class="map-rank-legend__title">${CURRENT_TEAM.name} — ${CURRENT_TEAM.leagueLabel} results (${wins} wins, ${losses} losses)</p>
    <div class="map-rank-legend__summary">
      <span class="map-rank-legend__item"><span class="map-rank-legend__swatch" style="background:${RESULT_COLORS.win}"></span> Win</span>
      <span class="map-rank-legend__item"><span class="map-rank-legend__swatch" style="background:${RESULT_COLORS.loss}"></span> Loss</span>
    </div>
    <ul class="map-rank-legend__list">${items}</ul>`;
}

function addResultMarkers(map, results) {
  clearCityMarkers();
  clearRankHeatLayers();
  removeHeatLayer();

  const positioned = buildPositionedResults(results);

  cityMarkers = positioned.map((result) =>
    L.circleMarker([result.displayLat, result.displayLng], {
      radius: 7,
      color: "#e8f2f0",
      weight: 2,
      fillColor: RESULT_COLORS[result.outcome],
      fillOpacity: 0.95,
    })
      .bindPopup(formatResultPopup(result))
      .addTo(map)
  );

  return positioned;
}

function addRankHeatLayers(map, teams) {
  clearRankHeatLayers();
  clearCityMarkers();

  const totalTeams = teams.length;

  rankHeatLayers = teams.map((team) => {
    const color = getRankTeamHeatColor(team);
    const intensity = getRankIntensity(team.rank, totalTeams);

    return L.heatLayer([[team.displayLat, team.displayLng, intensity]], {
      radius: getRankHeatRadius(team.rank, totalTeams),
      blur: HEATMAP_OPTIONS.blur,
      maxZoom: HEATMAP_OPTIONS.maxZoom,
      minOpacity: HEATMAP_OPTIONS.minOpacity,
      gradient: createRankGradient(color),
    }).addTo(map);
  });

  cityMarkers = teams.map((team) => {
    const color = getRankTeamHeatColor(team);
    return L.circleMarker([team.displayLat, team.displayLng], {
      radius: 5,
      color: "#e8f2f0",
      weight: 1,
      fillColor: color,
      fillOpacity: 0.95,
    })
      .bindPopup(formatTeamPopup(team))
      .addTo(map);
  });
}

function fitMapToPoints(map, points, { animate = false } = {}) {
  if (!points.length) {
    map.setView([ISRAEL_CENTER.lat, ISRAEL_CENTER.lng], MAP_DEFAULT_ZOOM, { animate });
    return;
  }

  if (points.length === 1) {
    map.setView([points[0].lat, points[0].lng], 10, { animate });
    return;
  }

  const bounds = L.latLngBounds(points.map((point) => [point.lat, point.lng]));
  map.fitBounds(bounds.pad(0.18), { animate });
}

function fitMapToCities(map, cities, { animate = false } = {}) {
  fitMapToPoints(
    map,
    cities.map((city) => ({ lat: city.lat, lng: city.lng })),
    { animate }
  );
}

function updateMapActionButtons() {
  const modeButtons = {
    heatmap: "map-league-btn",
    rankings: "map-rankings-btn",
    results: "map-results-btn",
    location: "map-locate-btn",
  };

  for (const [mode, id] of Object.entries(modeButtons)) {
    const btn = document.getElementById(id);
    if (!btn) continue;
    btn.classList.toggle("map-action-btn--active", mapMode === mode);
  }
}

function showHeatmapView({ animate = false } = {}) {
  const map = ensureMap();
  if (!map || !leagueCities?.length) return;

  mapMode = "heatmap";
  removeAllHeatLayers();
  heatLayer = createHeatLayer(leagueCities).addTo(map);
  addCityMarkers(map, leagueCities);
  renderHeatmapLegend(leagueCities);

  const cityCount = leagueCities.length;
  const teamCount = leagueCities.reduce((sum, city) => sum + city.teams.length, 0);
  leagueStatusMessage = `${leagueName || "League table"} — ${cityCount} cities, ${teamCount} teams (heat intensity by points)`;
  setMapStatus(leagueStatusMessage);
  fitMapToCities(map, leagueCities, { animate });
  map.closePopup();
  map.invalidateSize();
  updateMapActionButtons();
}

function showRankingsView({ animate = true } = {}) {
  const map = ensureMap();
  if (!map || !leagueRows?.length) return;

  mapMode = "rankings";
  removeAllHeatLayers();

  const teams = buildRankedTeams(leagueRows);
  addRankHeatLayers(map, teams);
  renderRankLegend(teams);

  leagueStatusMessage = `${leagueName || "League table"} — ${CURRENT_TEAM.name} glow; other teams indigo (top six ranked by heat)`;
  setMapStatus(leagueStatusMessage);

  fitMapToPoints(
    map,
    teams.map((team) => ({ lat: team.displayLat, lng: team.displayLng })),
    { animate }
  );
  map.closePopup();
  map.invalidateSize();
  updateMapActionButtons();
}

function showResultsView({ animate = true } = {}) {
  const map = ensureMap();
  if (!map || !haifaLeagueResults?.length) return;

  mapMode = "results";
  removeAllHeatLayers();

  const positioned = addResultMarkers(map, haifaLeagueResults);
  renderResultsLegend(haifaLeagueResults);

  const wins = haifaLeagueResults.filter((result) => result.outcome === "win").length;
  const losses = haifaLeagueResults.filter((result) => result.outcome === "loss").length;
  leagueStatusMessage = `${CURRENT_TEAM.name} — ${haifaLeagueResults.length} ${CURRENT_TEAM.leagueLabel} results (${wins} wins, ${losses} losses)`;
  setMapStatus(leagueStatusMessage);

  fitMapToPoints(
    map,
    positioned.map((result) => ({
      lat: result.displayLat,
      lng: result.displayLng,
    })),
    { animate }
  );
  map.closePopup();
  map.invalidateSize();
  updateMapActionButtons();
}

function jumpToLeagueCities() {
  showHeatmapView({ animate: true });
}

function jumpToRankings() {
  showRankingsView({ animate: true });
}

function jumpToResults() {
  showResultsView({ animate: true });
}

function updateLeagueHeatmap(cities, name) {
  const map = ensureMap();
  if (!map) return;

  leagueName = name || "League table";
  leagueCities = cities;
  mapMode = "heatmap";

  removeAllHeatLayers();
  heatLayer = createHeatLayer(cities).addTo(map);
  addCityMarkers(map, cities);
  renderHeatmapLegend(cities);
  fitMapToCities(map, cities);

  const leagueBtn = document.getElementById("map-league-btn");
  const rankingsBtn = document.getElementById("map-rankings-btn");
  const resultsBtn = document.getElementById("map-results-btn");
  if (leagueBtn) leagueBtn.disabled = false;
  if (rankingsBtn) rankingsBtn.disabled = !leagueRows?.length;
  if (resultsBtn) resultsBtn.disabled = !haifaLeagueResults?.length;

  const cityCount = cities.length;
  const teamCount = cities.reduce((sum, city) => sum + city.teams.length, 0);
  leagueStatusMessage = `${leagueName} — ${cityCount} cities, ${teamCount} teams (heat intensity by points)`;
  setMapStatus(leagueStatusMessage);
  map.invalidateSize();
  updateMapActionButtons();
}

function jumpToUserLocation() {
  const map = ensureMap();
  if (!map || !userLocation) return;

  mapMode = "location";
  map.invalidateSize();
  map.setView([userLocation.lat, userLocation.lng], USER_LOCATION_ZOOM, {
    animate: true,
  });
  userLocationMarker?.openPopup();
  updateMapActionButtons();
  refreshUserLocationLegend();
}

function requestUserLocation(onSuccess, onError) {
  if (!navigator.geolocation) {
    onError?.();
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      onSuccess(latitude, longitude, accuracy);
    },
    () => onError?.(),
    GEOLOCATION_OPTIONS
  );
}

function setUserLocation(lat, lng, accuracy = null) {
  const map = ensureMap();
  if (!map) return;

  userLocation = { lat, lng };
  userLocationAccuracy =
    accuracy != null && Number.isFinite(accuracy) ? accuracy : null;
  userLocationDetails = null;
  userLocationGeocodePromise = null;
  userLocationTeams = null;
  userLocationTeamsPromise = null;

  if (userLocationMarker) {
    map.removeLayer(userLocationMarker);
  }

  userLocationMarker = L.circleMarker([lat, lng], {
    radius: 7,
    color: "#93c5fd",
    weight: 2,
    fillColor: "#2563eb",
    fillOpacity: 1,
  })
    .bindPopup(
      `<strong>Your location</strong><br>${formatGpsCoordinates(lat, lng)}`
    )
    .addTo(map);

  setMapStatus(`${leagueStatusMessage} · Your location shown as blue dot`);
}

function detectUserLocation() {
  requestUserLocation((lat, lng, accuracy) => setUserLocation(lat, lng, accuracy));
}

function setupMapButtons() {
  const leagueBtn = document.getElementById("map-league-btn");
  leagueBtn?.addEventListener("click", jumpToLeagueCities);

  const rankingsBtn = document.getElementById("map-rankings-btn");
  rankingsBtn?.addEventListener("click", jumpToRankings);

  const resultsBtn = document.getElementById("map-results-btn");
  resultsBtn?.addEventListener("click", jumpToResults);

  const locateBtn = document.getElementById("map-locate-btn");
  if (!locateBtn) return;

  if (!navigator.geolocation) {
    locateBtn.hidden = true;
    return;
  }

  locateBtn.addEventListener("click", () => {
    if (userLocation) {
      jumpToUserLocation();
      locateBtn.focus();
      return;
    }

    locateBtn.disabled = true;
    locateBtn.textContent = "Finding location…";

    requestUserLocation(
      (lat, lng, accuracy) => {
        setUserLocation(lat, lng, accuracy);
        locateBtn.disabled = false;
        locateBtn.textContent = "Location";
        jumpToUserLocation();
        locateBtn.focus();
      },
      () => {
        locateBtn.disabled = false;
        locateBtn.textContent = "Location";
        setMapStatus(
          `${leagueStatusMessage} · Could not access your location`,
          true
        );
      }
    );
  });
}

function normalizeLeagueRecord(raw) {
  const wins = Number(raw?.wins) || 0;
  const losses = Number(raw?.losses) || 0;
  const ties = Number(raw?.ties) || 0;
  return { wins, losses, ties };
}

/** Same palette as monthly uptime doughnut (app.js chartColors). */
const RESULT_DOUGHNUT_COLORS =
  CURRENT_TEAM.slug === "aek-athens"
    ? { win: "#000000", loss: "#dc2626", tie: "#f5c518" }
    : { win: "#1a9b7a", loss: "#8a3b2b", tie: "#c4a35a" };

const HAIFA_LOGO_URL = CURRENT_TEAM.logo;
const haifaCenterLogo = new Image();
haifaCenterLogo.src = HAIFA_LOGO_URL;
let haifaDoughnutLogoPluginRegistered = false;

function registerHaifaDoughnutLogoPlugin() {
  if (haifaDoughnutLogoPluginRegistered || typeof Chart === "undefined") return;
  haifaDoughnutLogoPluginRegistered = true;

  haifaCenterLogo.addEventListener("load", () => {
    resultsPieChart?.update("none");
  });

  Chart.register({
    id: "haifaDoughnutLogo",
    afterDraw(chart) {
      if (chart.canvas?.id !== "haifa-results-pie") return;
      if (!haifaCenterLogo.complete || !haifaCenterLogo.naturalWidth) return;

      const arc = chart.getDatasetMeta(0)?.data?.[0];
      if (!arc) return;

      const size = arc.innerRadius * 2 * 0.84;
      // Haifa's logo sits slightly high; AEK's is centred exactly.
      const offsetY = CURRENT_TEAM.slug === "aek-athens" ? 0 : -10;
      const { ctx } = chart;
      ctx.save();
      ctx.drawImage(
        haifaCenterLogo,
        arc.x - size / 2,
        arc.y - size / 2 + offsetY,
        size,
        size
      );
      ctx.restore();
    },
  });
}

function escapeSeasonResultText(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function seasonResultScore(match) {
  if (match.goalsScored != null && match.goalsConceded != null) {
    return `${match.goalsScored}-${match.goalsConceded}`;
  }
  if (match.outcome === "win") return "W";
  if (match.outcome === "loss") return "L";
  if (match.outcome === "draw") return "D";
  return match.scoreLabel || "";
}

function seasonResultClass(outcome) {
  if (outcome === "win") return "season-results__result--win";
  if (outcome === "loss") return "season-results__result--loss";
  return "season-results__result--draw";
}

function updateResultsOpponents(matches) {
  const legendEl = document.getElementById("haifa-results-legend");
  if (!legendEl) return;

  const list = Array.isArray(matches) ? matches : [];
  legendEl.innerHTML = list
    .map((match) => {
      const opponent = match.opponent || "Opponent";
      const score = seasonResultScore(match);
      const logo = match.opponentLogo
        ? `<img class="season-results__logo" src="${escapeSeasonResultText(match.opponentLogo)}" alt="" />`
        : "";
      const detail = [opponent, match.kickoffLabel, score].filter(Boolean).join(" · ");
      return `<li class="season-results__item" title="${escapeSeasonResultText(detail)}">
        <span class="season-results__result ${seasonResultClass(match.outcome)}">${escapeSeasonResultText(score)}</span>
        ${logo}
        <span class="season-results__name">${escapeSeasonResultText(opponent)}</span>
      </li>`;
    })
    .join("");
}

function formatMatchChartLabel(match, index) {
  if (match.kickoff) {
    const date = new Date(match.kickoff);
    if (!Number.isNaN(date.getTime())) {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
  }
  return `M${index + 1}`;
}

const SQUAD_PLAYER_PHOTO_FALLBACK =
  "https://www.fotmob.com/img/player-fallback-light.png";

function updateGoalScorers(scorers) {
  const listEl = document.getElementById("haifa-goal-scorers");
  if (!listEl) return;

  const list = (Array.isArray(scorers) ? scorers : []).filter(
    (player) => Number(player.goals) > 0
  );
  listEl.hidden = list.length === 0;
  listEl.innerHTML = list
    .map((player) => {
      const name = player.name || "Player";
      const goals = Number(player.goals) || 0;
      const photo = `<img class="goal-scorers__photo" src="${escapeSeasonResultText(player.photo || SQUAD_PLAYER_PHOTO_FALLBACK)}" alt="" />`;
      return `<li class="goal-scorers__item" title="${escapeSeasonResultText(`${name}: ${goals}`)}">
        <span class="goal-scorers__count">${goals}</span>
        ${photo}
        <span class="goal-scorers__name">${escapeSeasonResultText(name)}</span>
      </li>`;
    })
    .join("");

  listEl.querySelectorAll(".goal-scorers__photo").forEach((img) => {
    img.addEventListener("error", () => {
      if (img.dataset.fallbackApplied === "1") return;
      img.dataset.fallbackApplied = "1";
      img.src = SQUAD_PLAYER_PHOTO_FALLBACK;
      img.classList.add("goal-scorers__photo--fallback");
    });
  });
}

function renderGoalsLineChart(matches) {
  const panelEl = document.getElementById("map-goals-panel");
  const canvas = document.getElementById("haifa-goals-chart");
  if (!panelEl || !canvas || typeof Chart === "undefined") return;

  const list = Array.isArray(matches) ? matches : [];
  if (!list.length) {
    panelEl.hidden = true;
    goalsLineChart?.destroy();
    goalsLineChart = null;
    return;
  }

  panelEl.hidden = false;

  if (goalsLineChart) {
    goalsLineChart.destroy();
  }

  const labels = list.map((match, index) => formatMatchChartLabel(match, index));
  const goalsScored = list.map((match) => Number(match.goalsScored) || 0);
  const goalsConceded = list.map((match) => Number(match.goalsConceded) || 0);
  const pointRadius = list.length > 24 ? 2 : 4;

  goalsLineChart = new Chart(canvas, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Goals scored",
          data: goalsScored,
          borderColor: MAP_CHART_COLORS.line,
          backgroundColor: MAP_CHART_COLORS.fill,
          borderWidth: 2,
          pointRadius,
          pointHoverRadius: 6,
          pointBackgroundColor: MAP_CHART_COLORS.line,
          tension: 0.25,
          fill: true,
          spanGaps: true,
        },
        {
          label: "Goals conceded",
          data: goalsConceded,
          borderColor: MAP_CHART_COLORS.lineConceded,
          backgroundColor: MAP_CHART_COLORS.fillConceded,
          borderWidth: 2,
          pointRadius,
          pointHoverRadius: 6,
          pointBackgroundColor: MAP_CHART_COLORS.lineConceded,
          tension: 0.25,
          fill: true,
          spanGaps: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            title(items) {
              const match = list[items[0].dataIndex];
              return match?.kickoffLabel || items[0].label;
            },
            label(item) {
              const match = list[item.dataIndex];
              const opponent = match?.opponent ? ` vs ${match.opponent}` : "";
              const score = match?.scoreLabel ? ` (${match.scoreLabel})` : "";
              return `${item.dataset.label}: ${item.parsed.y}${opponent}${score}`;
            },
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "Match", color: MAP_CHART_COLORS.muted },
          ticks: {
            color: MAP_CHART_COLORS.muted,
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 12,
          },
          grid: { display: false },
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: MAP_CHART_COLORS.muted,
            stepSize: 1,
            precision: 0,
          },
          title: {
            display: true,
            text: "Goals",
            color: MAP_CHART_COLORS.muted,
          },
          grid: { color: MAP_CHART_COLORS.grid },
        },
      },
    },
  });
}

function renderResultsPie(record, matches) {
  const panelEl = document.getElementById("map-results-doughnut");
  const canvas = document.getElementById("haifa-results-pie");
  if (!panelEl || !canvas || typeof Chart === "undefined") return;

  const total = record.wins + record.losses + record.ties;
  if (!total) {
    panelEl.hidden = true;
    if (resultsPieChart) {
      resultsPieChart.destroy();
      resultsPieChart = null;
    }
    return;
  }

  panelEl.hidden = false;
  updateResultsOpponents(matches);

  if (resultsPieChart) {
    resultsPieChart.destroy();
  }

  registerHaifaDoughnutLogoPlugin();

  resultsPieChart = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: ["Wins", "Losses", "Ties"],
      datasets: [
        {
          data: [record.wins, record.losses, record.ties],
          backgroundColor: [
            RESULT_DOUGHNUT_COLORS.win,
            RESULT_DOUGHNUT_COLORS.loss,
            RESULT_DOUGHNUT_COLORS.tie,
          ],
          borderWidth: 0,
          hoverOffset: 4,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      cutout: "62%",
      plugins: {
        legend: { display: false },
      },
    },
  });
}

function updateMapResultsCharts(record, matchGoals, goalScorers) {
  const wrapperEl = document.getElementById("map-results-charts");
  if (!wrapperEl) return;

  const total = record.wins + record.losses + record.ties;
  const hasGoals = Array.isArray(matchGoals) && matchGoals.length > 0;
  const hasScorers = Array.isArray(goalScorers) && goalScorers.length > 0;

  if (!total && !hasGoals && !hasScorers) {
    wrapperEl.hidden = true;
    renderResultsPie({ wins: 0, losses: 0, ties: 0 }, []);
    renderGoalsLineChart([]);
    updateGoalScorers([]);
    return;
  }

  wrapperEl.hidden = false;
  renderGoalsLineChart(matchGoals);
  updateGoalScorers(goalScorers);
  renderResultsPie(record, matchGoals);
}

async function loadHaifaLeagueResults() {
  try {
    const res = await fetch(teamApi("fixtures"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    haifaLeagueResults = Array.isArray(data.leagueResults) ? data.leagueResults : [];
    const matchGoals = Array.isArray(data.leagueMatchGoals) ? data.leagueMatchGoals : [];
    const goalScorers = Array.isArray(data.leagueGoalScorers) ? data.leagueGoalScorers : [];
    updateMapResultsCharts(normalizeLeagueRecord(data.leagueRecord), matchGoals, goalScorers);

    const resultsBtn = document.getElementById("map-results-btn");
    if (resultsBtn) resultsBtn.disabled = !haifaLeagueResults.length;
  } catch {
    haifaLeagueResults = [];
    updateMapResultsCharts({ wins: 0, losses: 0, ties: 0 }, [], []);
  }
}

async function loadLeagueHeatmap() {
  setMapStatus("Loading league cities…");

  try {
    const res = await fetch(teamApi("table"));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cities = Array.isArray(data.cities) ? data.cities : [];
    leagueRows = Array.isArray(data.rows)
      ? data.rows.filter((row) => row.lat != null && row.lng != null)
      : [];

    if (!cities.length) {
      throw new Error("No city locations found for league table teams.");
    }

    updateLeagueHeatmap(cities, data.leagueName);
  } catch {
    setMapStatus("Could not load league city heatmap.", true);
  }
}

function watchMapVisibility() {
  const section = document.getElementById("location-map");
  if (!section || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting && mapInstance) {
          window.setTimeout(() => mapInstance.invalidateSize(), 50);
        }
      });
    },
    { threshold: 0.15 }
  );

  observer.observe(section);
}

window.addEventListener("app-view-change", (event) => {
  if (event.detail?.view === "map" && mapInstance) {
    window.setTimeout(() => mapInstance.invalidateSize(), 50);
    window.setTimeout(() => mapInstance.invalidateSize(), 300);
    window.setTimeout(() => resultsPieChart?.resize(), 80);
    window.setTimeout(() => goalsLineChart?.resize(), 80);
  }
});

async function initLocationMap() {
  const mapEl = document.getElementById("leaflet-map");
  if (!mapEl) return;

  ensureMap();
  setupMapButtons();
  await Promise.all([loadLeagueHeatmap(), loadHaifaLeagueResults()]);
  detectUserLocation();
  watchMapVisibility();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLocationMap);
} else {
  initLocationMap();
}
