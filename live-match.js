const { httpsFetch } = require("./lib/https-fetch");
const { clearFixturesCache } = require("./fixtures");

const LIVE_CACHE_MS = 15 * 1000;
const liveCache = new Map();
const fixturesClearedFor = new Set();

const PREFERRED_STAT_KEYS = [
  "BallPossesion",
  "expected_goals",
  "total_shots",
  "touches_opp_box",
];

function cleanText(value) {
  if (value == null) return "";
  return String(value)
    .replace(/[\u200e\u200f]/g, "")
    .trim();
}

function scoreValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function minuteLabel(event) {
  const base = event?.timeStr ?? event?.time;
  if (base == null || base === "") return "";
  const added = Number(event.overloadTime);
  if (added > 0) return `${base}+${added}′`;
  return `${base}′`;
}

function goalDetail(event) {
  const parts = [];
  if (Array.isArray(event.newScore) && event.newScore.length >= 2) {
    parts.push(`${scoreValue(event.newScore[0])} – ${scoreValue(event.newScore[1])}`);
  }
  const description = String(event.goalDescriptionKey || event.suffixKey || event.suffix || "");
  if (event.ownGoal || /own.?goal/i.test(description)) {
    parts.push("Own goal");
  } else if (/pen/i.test(description)) {
    parts.push("Penalty");
  }
  if (event.assistInput) parts.push(`assist by ${cleanText(event.assistInput)}`);
  return parts.join(" · ");
}

function eventTimeValue(event) {
  return (Number(event?.time) || 0) * 100 + (Number(event?.overloadTime) || 0);
}

function goalsFromFacts(events) {
  const list = events?.events;
  if (!Array.isArray(list)) return [];
  return list.filter((event) => event?.type === "Goal");
}

function goalsFromHeader(events) {
  const rows = [];
  const add = (bucket, isHome) => {
    if (!bucket || typeof bucket !== "object") return;
    for (const list of Object.values(bucket)) {
      if (!Array.isArray(list)) continue;
      for (const event of list) {
        if (!event) continue;
        rows.push({ ...event, isHome: event.isHome ?? isHome, type: event.type || "Goal" });
      }
    }
  };
  add(events?.homeTeamGoals, true);
  add(events?.awayTeamGoals, false);
  return rows;
}

function cardLabel(event) {
  const card = String(event.card || "");
  if (/yellowred|second/i.test(card)) return "Second yellow";
  if (/red/i.test(card)) return "Red card";
  return "Yellow card";
}

function halfLabel(event) {
  const key = String(event.halfStrKey || "");
  const short = String(event.halfStrShort || "");
  if (/full/i.test(key) || /^ft$/i.test(short)) return "Full time";
  if (/extra/i.test(key) || /^et$/i.test(short)) return "Extra time";
  return "Half time";
}

function scoreLine(event) {
  if (event.homeScore == null || event.awayScore == null) return "";
  return `${scoreValue(event.homeScore)} – ${scoreValue(event.awayScore)}`;
}

function goalEventDetail(event) {
  const parts = [];
  if (Array.isArray(event.newScore) && event.newScore.length >= 2) {
    parts.push(`${scoreValue(event.newScore[0])} – ${scoreValue(event.newScore[1])}`);
  } else {
    const line = scoreLine(event);
    if (line) parts.push(line);
  }
  const assist = cleanText(event.assistStr || event.assistInput);
  if (assist) parts.push(/^assist\b/i.test(assist) ? assist : `assist ${assist}`);
  return parts.join(" · ");
}

function normalizeEvents(payload) {
  const list = payload?.content?.matchFacts?.events?.events;
  if (!Array.isArray(list)) return [];

  const rows = [];
  list.forEach((event, index) => {
    if (!event?.type) return;
    const row = {
      id: String(event.reactKey || `${event.type}-${event.time || 0}-${index}`),
      minute: minuteLabel(event),
      isHome: event.isHome == null ? null : Boolean(event.isHome),
      marker: false,
      type: "",
      label: "",
      player: "",
      detail: "",
    };

    if (event.type === "Goal") {
      const description = String(
        event.goalDescriptionKey || event.suffixKey || event.suffix || event.goalDescription || ""
      );
      row.type = "goal";
      row.label = event.ownGoal ? "Own goal" : /pen/i.test(description) ? "Penalty" : "Goal";
      row.player = cleanText(event.nameStr || event.player?.name || "Goal");
      row.detail = goalEventDetail(event);
    } else if (event.type === "Card") {
      row.type = /red/i.test(String(event.card || "")) ? "card-red" : "card-yellow";
      row.label = cardLabel(event);
      row.player = cleanText(event.nameStr || event.player?.name || "");
      row.detail = cleanText(event.cardReason?.defaultText || event.cardDescription || "");
    } else if (event.type === "Substitution") {
      // FotMob lists the player coming on first, then the player going off.
      const swap = Array.isArray(event.swap) ? event.swap : [];
      const incoming = cleanText(swap[0]?.name);
      const outgoing = cleanText(swap[1]?.name);
      row.type = "sub";
      row.label = "Substitution";
      row.player = incoming || outgoing;
      row.detail = [
        incoming && outgoing ? `on for ${outgoing}` : "",
        event.injuredPlayerOut ? "Injury" : "",
      ]
        .filter(Boolean)
        .join(" · ");
    } else if (event.type === "Half") {
      row.type = "half";
      row.marker = true;
      row.minute = "";
      row.label = halfLabel(event);
      row.detail = scoreLine(event);
    } else if (event.type === "AddedTime") {
      row.type = "added";
      row.marker = true;
      row.minute = "";
      row.label = cleanText(event.minutesAddedStr) || "Added time";
    } else if (event.type === "MissedPenalty") {
      row.type = "missed-penalty";
      row.label = "Missed penalty";
      row.player = cleanText(event.nameStr || event.player?.name || "");
      row.detail = cleanText(event.missedPenaltyOutcome?.defaultText || "");
    } else {
      return;
    }

    rows.push(row);
  });

  return rows;
}

function normalizeGoals(payload) {
  const fromFacts = goalsFromFacts(payload?.content?.matchFacts?.events);
  const source = fromFacts.length ? fromFacts : goalsFromHeader(payload?.header?.events);
  return source
    .slice()
    .sort((a, b) => eventTimeValue(b) - eventTimeValue(a))
    .map((event, index) => ({
      id: String(event.eventId || `${event.time || 0}-${event.playerId || index}`),
      minute: minuteLabel(event),
      player: cleanText(event.nameStr || event.fullName || event.player?.name || "Goal"),
      detail: goalDetail(event),
      isHome: Boolean(event.isHome),
    }));
}

function statusLabel(headerStatus, general) {
  const reason = headerStatus?.reason || {};
  const short = cleanText(reason.short);
  const long = cleanText(reason.long);
  if (headerStatus?.cancelled) return "Cancelled";
  if (headerStatus?.finished || general?.finished) {
    if (/^ft$/i.test(short) || /full/i.test(long)) return "Full time";
    if (/^aet$/i.test(short)) return "After extra time";
    if (/pen/i.test(short) || /pen/i.test(long)) return "Penalties";
    return long || short || "Full time";
  }
  if (/^ht$/i.test(short) || /half/i.test(long)) return "Half time";
  const minute = cleanText(headerStatus?.liveTime?.short);
  if (minute) {
    if (/^ht$/i.test(minute)) return "Half time";
    if (/^ft$/i.test(minute)) return "Full time";
    if (/[′'’ʹ]$/.test(minute)) return minute.replace(/[′'’ʹ]$/, "′");
    return `${minute}′`;
  }
  if (headerStatus?.started || headerStatus?.ongoing || general?.started) return "Live";
  return "Kickoff";
}

function formatStatValue(value, key) {
  if (value == null || value === "") return "–";
  const text = cleanText(value);
  if (key === "BallPossesion" && /^\d+(\.\d+)?$/.test(text)) return `${text}%`;
  return text;
}

function statNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const text = cleanText(value);
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return null;
}

function shareFromNumbers(homeNumber, awayNumber) {
  if (homeNumber == null || awayNumber == null) return null;
  const total = homeNumber + awayNumber;
  if (!(total > 0)) return null;
  return (homeNumber / total) * 100;
}

function normalizeStatRow(row) {
  if (!row || row.type === "title" || !cleanText(row.title)) return null;
  const homeRaw = row.stats?.[0];
  const awayRaw = row.stats?.[1];
  const highlighted =
    row.highlighted === "home" || row.highlighted === "away" ? row.highlighted : "";
  return {
    key: String(row.key || row.title),
    title: cleanText(row.title),
    home: formatStatValue(homeRaw, row.key),
    away: formatStatValue(awayRaw, row.key),
    homeShare:
      row.type === "graph"
        ? shareFromNumbers(statNumber(homeRaw), statNumber(awayRaw))
        : null,
    highlighted,
  };
}

const STAT_PERIODS = [
  { key: "All", label: "All" },
  { key: "FirstHalf", label: "1st half" },
  { key: "SecondHalf", label: "2nd half" },
];

function normalizeStatPeriods(stats) {
  const periods = stats?.Periods;
  if (!periods || typeof periods !== "object") return [];
  const result = [];
  for (const def of STAT_PERIODS) {
    const groups = Array.isArray(periods[def.key]?.stats) ? periods[def.key].stats : [];
    const normalized = [];
    for (const group of groups) {
      const rows = (Array.isArray(group?.stats) ? group.stats : [])
        .map((row) => normalizeStatRow(row))
        .filter(Boolean);
      if (!rows.length) continue;
      normalized.push({
        key: String(group.key || group.title || "stats"),
        title: cleanText(group.title) || "Stats",
        stats: rows,
      });
    }
    if (!normalized.length) continue;
    result.push({ key: def.key, label: def.label, groups: normalized });
  }
  return result;
}

function normalizeTopStats(stats) {
  const groups = stats?.Periods?.All?.stats;
  if (!Array.isArray(groups)) return [];
  const top = groups.find((group) => group?.key === "top_stats") || groups[0];
  const rows = (Array.isArray(top?.stats) ? top.stats : []).filter(
    (row) => row && row.type !== "title" && row.title
  );
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const picked = [];
  for (const key of PREFERRED_STAT_KEYS) {
    const row = byKey.get(key);
    if (row) picked.push(row);
  }
  for (const row of rows) {
    if (picked.length >= 4) break;
    if (!picked.includes(row)) picked.push(row);
  }

  return picked
    .slice(0, 4)
    .map((row) => normalizeStatRow(row))
    .filter(Boolean);
}

const ROLE_LABELS = ["Keeper", "Defender", "Midfielder", "Attacker"];

const LINEUP_BADGES = {
  yellowCard: "yellow",
  redCard: "red",
  yellowRedCard: "red",
  secondYellow: "red",
  goal: "goal",
  penaltyGoal: "goal",
  ownGoal: "goal",
};

function teamLogoUrl(id) {
  if (!id) return "";
  return `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;
}

function playerNameParts(player) {
  const full = cleanText(player?.name);
  let first = cleanText(player?.firstName);
  let last = cleanText(player?.lastName);
  if (!first && !last) {
    const parts = full.split(/\s+/).filter(Boolean);
    if (parts.length > 1) {
      first = parts[0];
      last = parts.slice(1).join(" ");
    } else if (parts.length === 1) {
      last = parts[0];
    }
  }
  const name = full || [first, last].filter(Boolean).join(" ");
  if (!name) return null;
  return { first, last, name };
}

function roleLabel(player) {
  const id = Number(player?.usualPlayingPositionId);
  return ROLE_LABELS[id] || "";
}

function lineupBadges(performance) {
  const list = performance?.events;
  if (!Array.isArray(list)) return [];
  const seen = new Set();
  const badges = [];
  for (const event of list) {
    const badge = LINEUP_BADGES[event?.type];
    if (!badge || seen.has(badge)) continue;
    seen.add(badge);
    badges.push(badge);
  }
  return badges;
}

function pitchPoint(player) {
  const layout = player?.verticalLayout;
  const x = Number(layout?.x);
  const y = Number(layout?.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return {
    x: Math.min(84, Math.max(16, x * 100)),
    y: Math.min(92, Math.max(8, y * 100)),
  };
}

function unavailableLabel(player) {
  const info = player?.unavailability || {};
  const type = String(info.type || "");
  const back = cleanText(info.expectedReturn);
  const when = back && !/^unknown$/i.test(back) ? back : "";
  if (/suspen/i.test(type)) return when ? `Suspended · ${when}` : "Suspended";
  if (/injur/i.test(type)) return when ? `Injured · ${when}` : "Injured";
  return when || "Unavailable";
}

function normalizePitchPlayer(player) {
  if (!player) return null;
  const parts = playerNameParts(player);
  if (!parts) return null;
  const point = pitchPoint(player);
  return {
    id: String(player.id || parts.name),
    name: parts.name,
    firstName: parts.first,
    lastName: parts.last,
    fullName: parts.name,
    shirt: cleanText(player.shirtNumber),
    badges: lineupBadges(player.performance),
    x: point ? point.x : null,
    y: point ? point.y : null,
  };
}

function normalizeBenchPlayer(player) {
  if (!player) return null;
  const name = cleanText(player.name);
  if (!name) return null;
  return {
    id: String(player.id || name),
    name,
    shirt: cleanText(player.shirtNumber),
    role: roleLabel(player),
  };
}

function normalizeUnavailablePlayer(player) {
  if (!player) return null;
  const name = cleanText(player.name);
  if (!name) return null;
  return {
    id: String(player.id || name),
    name,
    shirt: cleanText(player.shirtNumber),
    reason: unavailableLabel(player),
  };
}

function normalizeLineupSide(team) {
  if (!team || typeof team !== "object") return null;
  const starters = (Array.isArray(team.starters) ? team.starters : [])
    .map(normalizePitchPlayer)
    .filter(Boolean);
  if (!starters.length) return null;
  const teamId = team.id ?? team.teamId;
  return {
    id: teamId == null || teamId === "" ? null : String(teamId),
    name: cleanText(team.name),
    logo: teamLogoUrl(teamId),
    formation: cleanText(team.formation),
    coach: cleanText(team.coach?.name),
    onPitch: starters.every((player) => player.x != null && player.y != null),
    starters,
    subs: (Array.isArray(team.subs) ? team.subs : []).map(normalizeBenchPlayer).filter(Boolean),
    unavailable: (Array.isArray(team.unavailable) ? team.unavailable : [])
      .map(normalizeUnavailablePlayer)
      .filter(Boolean),
  };
}

function normalizeLineup(payload) {
  const lineup = payload?.content?.lineup;
  if (!lineup || typeof lineup !== "object") return null;
  const home = normalizeLineupSide(lineup.homeTeam);
  const away = normalizeLineupSide(lineup.awayTeam);
  if (!home && !away) return null;
  return { home, away };
}

function normalizeLiveMatch(payload) {
  const general = payload?.general || {};
  const headerStatus = payload?.header?.status || {};
  const teams = Array.isArray(payload?.header?.teams) ? payload.header.teams : [];
  const home = teams[0] || general.homeTeam || {};
  const away = teams[1] || general.awayTeam || {};
  const homeScore = scoreValue(home.score);
  const awayScore = scoreValue(away.score);
  const finished = Boolean(headerStatus.finished || general.finished);
  const cancelled = Boolean(headerStatus.cancelled);
  const started = Boolean(headerStatus.started || headerStatus.ongoing || general.started || finished);
  const ongoing = !finished && !cancelled && (headerStatus.ongoing === true || payload?.ongoing === true);

  return {
    matchId: String(general.matchId || ""),
    started,
    ongoing,
    finished,
    cancelled,
    statusLabel: statusLabel(headerStatus, general),
    home: cleanText(home.name || "Home"),
    away: cleanText(away.name || "Away"),
    homeScore,
    awayScore,
    goals: normalizeGoals(payload),
    events: normalizeEvents(payload),
    stats: normalizeTopStats(payload?.content?.stats),
    statPeriods: normalizeStatPeriods(payload?.content?.stats),
    lineup: normalizeLineup(payload),
  };
}

async function fetchLiveMatch(matchId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await httpsFetch(
      `https://www.fotmob.com/api/data/matchDetails?matchId=${encodeURIComponent(matchId)}`,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
          Accept: "application/json",
        },
        signal: controller.signal,
      }
    );

    if (!response.ok) {
      const error = new Error(`FotMob HTTP ${response.status}`);
      error.status = response.status === 404 ? 404 : 502;
      throw error;
    }

    return normalizeLiveMatch(await response.json());
  } catch (err) {
    if (err.status) throw err;
    const error = new Error(err.name === "AbortError" ? "Live score timed out" : "Live score unavailable");
    error.status = 502;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function getLiveMatch(matchId) {
  const id = String(matchId || "").trim();
  if (!/^\d+$/.test(id)) {
    const error = new Error("Invalid match id");
    error.status = 400;
    throw error;
  }

  const cached = liveCache.get(id);
  if (cached && Date.now() - cached.at < LIVE_CACHE_MS) {
    return cached.data;
  }

  const data = await fetchLiveMatch(id);
  data.matchId = data.matchId || id;
  liveCache.set(id, { at: Date.now(), data });

  if ((data.finished || data.cancelled) && !fixturesClearedFor.has(id)) {
    fixturesClearedFor.add(id);
    clearFixturesCache();
  }

  return data;
}

module.exports = {
  getLiveMatch,
  normalizeLiveMatch,
};
