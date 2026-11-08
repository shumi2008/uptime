function formatUptime(totalSeconds) {
  const seconds = Math.floor(totalSeconds % 60);
  const minutes = Math.floor((totalSeconds / 60) % 60);
  const hours = Math.floor((totalSeconds / 3600) % 24);
  const days = Math.floor(totalSeconds / 86400);

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(" ");
}

let uptimeBaseSeconds = null;
let uptimeSyncedAt = null;
let uptimeHostname = "";

function renderUptime() {
  const uptimeEl = document.getElementById("uptime");
  const hostnameEl = document.getElementById("hostname");
  if (!uptimeEl) return;

  if (uptimeBaseSeconds == null || uptimeSyncedAt == null) {
    uptimeEl.textContent = "Loading…";
    hostnameEl.textContent = "";
    return;
  }

  const elapsedSeconds = Math.floor((Date.now() - uptimeSyncedAt) / 1000);
  uptimeEl.textContent = formatUptime(uptimeBaseSeconds + elapsedSeconds);
  hostnameEl.textContent = uptimeHostname ? `on ${uptimeHostname}` : "";
}

async function syncUptimeFromServer() {
  const uptimeEl = document.getElementById("uptime");
  const hostnameEl = document.getElementById("hostname");

  try {
    const res = await fetch("/api/uptime");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    uptimeBaseSeconds = Number(data.seconds);
    uptimeSyncedAt = Date.now();
    uptimeHostname = data.hostname || "";
    renderUptime();
  } catch {
    uptimeBaseSeconds = null;
    uptimeSyncedAt = null;
    uptimeHostname = "";
    uptimeEl.textContent = "Unavailable";
    hostnameEl.textContent = "";
  }
}

syncUptimeFromServer();
setInterval(syncUptimeFromServer, 60_000);
setInterval(renderUptime, 1000);

async function loadLoggedInUser() {
  const el = document.getElementById("logged-in-user");
  const mobileEl = document.getElementById("logged-in-user-mobile");
  const usersNavLink = document.getElementById("users-nav-link");
  const usersSection = document.getElementById("users");

  try {
    const res = await fetch("/api/me");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const isAdmin = Boolean(data.isAdmin);

    if (usersNavLink) usersNavLink.hidden = !isAdmin;
    if (usersSection) usersSection.hidden = !isAdmin;

    if (data.username) {
      if (el) {
        el.textContent = data.username;
        el.hidden = false;
      }
      if (mobileEl) {
        mobileEl.textContent = data.username;
        mobileEl.hidden = false;
      }
    }
  } catch {
    if (el) el.hidden = true;
    if (mobileEl) mobileEl.hidden = true;
    if (usersNavLink) usersNavLink.hidden = true;
    if (usersSection) usersSection.hidden = true;
  }
}

loadLoggedInUser();
if (document.getElementById("hero-visual")) {
  initMainPageHero();
} else {
  placeHeroLogo();
  placeHeroSignals();
}

async function logout() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch {
    // Redirect even if the request fails.
  }
  window.location.href = "/login";
}

document.getElementById("logout-btn")?.addEventListener("click", logout);
document.getElementById("logout-btn-mobile")?.addEventListener("click", logout);

async function registerBrowserSession() {
  try {
    await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        path: window.location.pathname,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    });
  } catch {
    // Session tracking is best-effort.
  }
}

registerBrowserSession();

const { createApp, ref, computed, onMounted, onBeforeUnmount, nextTick, watch } = Vue;

function isLigatHaAlCompetition(name) {
  if (!name) return false;
  const normalized = String(name)
    .toLowerCase()
    .replace(/[’`´]/g, "'");
  return normalized.includes("ligat ha");
}

function competitionMetaPart(name) {
  if (!name || isLigatHaAlCompetition(name)) return "";
  return String(name).trim();
}

function joinFixtureMeta(parts) {
  return parts.filter(Boolean).join(" · ");
}

function nextMatchMetaLine(match, started = false) {
  if (!match) return "";
  const kickoffPart = started ? "" : match.kickoffLabel;
  return joinFixtureMeta([competitionMetaPart(match.competition), kickoffPart]);
}

function isSameFixture(a, b) {
  if (!a || !b) return false;
  if (a.id != null && b.id != null && String(a.id) === String(b.id)) return true;
  return a.kickoff === b.kickoff && a.home === b.home && a.away === b.away;
}

function countdownToKickoff(kickoffIso, nowMs) {
  if (!kickoffIso) return null;
  const kickoffMs = Date.parse(kickoffIso);
  if (Number.isNaN(kickoffMs)) return null;
  const remainingSeconds = Math.floor((kickoffMs - nowMs) / 1000);
  if (remainingSeconds <= 0) {
    return { due: true, label: "0m 0s", caption: "awaiting kickoff" };
  }
  return {
    due: false,
    label: formatUptime(remainingSeconds),
    caption: "until kickoff",
  };
}

const POST_MATCH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

function isWithinPostMatchWindow(kickoffIso, nowMs) {
  const kickoffMs = Date.parse(kickoffIso || "");
  if (Number.isNaN(kickoffMs)) return false;
  const ageMs = nowMs - kickoffMs;
  return ageMs >= 0 && ageMs <= POST_MATCH_WINDOW_MS;
}

function fixtureCardMetaLine(match) {
  if (!match) return "";
  const venueLine =
    match.venue && match.opponent ? `${match.venue} vs ${match.opponent}` : "";
  return joinFixtureMeta([competitionMetaPart(match.competition), venueLine]);
}

function resultCardMetaLine(match) {
  if (!match) return "";
  return competitionMetaPart(match.competition);
}

const FIXTURES_NEXT_OPEN_KEY = "uptime-fixtures-next-open";
const FIXTURES_RESULTS_OPEN_KEY = "uptime-fixtures-results-open";

function readStoredFlag(key) {
  try {
    const stored = sessionStorage.getItem(key);
    if (stored === "1") return true;
    if (stored === "0") return false;
  } catch {
    // Ignore storage errors in private mode.
  }
  return null;
}

function readFixtureSectionOpen(key, defaultOpen = true) {
  const stored = readStoredFlag(key);
  return stored === null ? defaultOpen : stored;
}

function liveSectionOpenKey(section, matchId) {
  return `uptime-fixtures-${section}-open-live-${matchId}`;
}

function teamNameKey(name) {
  return String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function ordinalRank(rank) {
  const value = Number(rank);
  if (!Number.isInteger(value) || value < 1) return "";
  const mod100 = value % 100;
  if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

function tableRankMap(rows) {
  const ranks = new Map();
  for (const row of rows) {
    const label = ordinalRank(row?.rank);
    if (!label) continue;
    if (row.id != null && row.id !== "") ranks.set(`id:${row.id}`, label);
    const name = teamNameKey(row.name);
    if (name) ranks.set(`name:${name}`, label);
  }
  return ranks;
}

function lineupTablePosition(side, ranks) {
  if (!side || !ranks?.size) return "";
  if (side.id != null && side.id !== "") {
    const byId = ranks.get(`id:${side.id}`);
    if (byId) return byId;
  }
  return ranks.get(`name:${teamNameKey(side.name)}`) || "";
}

function storeFixtureSectionOpen(key, open) {
  try {
    sessionStorage.setItem(key, open ? "1" : "0");
  } catch {
    // Ignore storage errors in private mode.
  }
}

const MatchReport = {
  props: {
    report: { type: Object, required: true },
  },
  template:
    document.getElementById("match-report-template")?.innerHTML ||
    '<p class="charts-error">Match report failed to load.</p>',
  setup(props) {
    const statPeriod = ref("All");
    const allStatsOpen = ref(false);
    const activeStatPeriod = computed(() => {
      const periods = props.report?.statPeriods || [];
      if (!periods.length) return null;
      return periods.find((period) => period.key === statPeriod.value) || periods[0];
    });

    function selectStatPeriod(key) {
      statPeriod.value = key;
    }

    function onAllStatsToggle(event) {
      allStatsOpen.value = Boolean(event.target?.open);
    }

    const lineupOpen = ref(false);
    const isMobile = ref(false);
    let mobileQuery = null;
    const syncMobile = () => {
      isMobile.value = Boolean(mobileQuery?.matches);
    };
    onMounted(() => {
      mobileQuery = window.matchMedia("(max-width: 640px)");
      syncMobile();
      mobileQuery.addEventListener("change", syncMobile);
    });
    onBeforeUnmount(() => {
      mobileQuery?.removeEventListener("change", syncMobile);
    });
    function toggleLineup() {
      if (isMobile.value) lineupOpen.value = !lineupOpen.value;
    }

    return {
      activeStatPeriod,
      selectStatPeriod,
      allStatsOpen,
      onAllStatsToggle,
      lineupOpen,
      isMobile,
      toggleLineup,
    };
  },
};

const chartColors = {
  up: "#1a9b7a",
  partial: "#c4a35a",
  down: "#6b7c79",
  future: "rgba(12, 26, 31, 0.08)",
  ink: "#0c1a1f",
  muted: "#4a6360",
  grid: "rgba(12, 26, 31, 0.08)",
  line: "#1a9b7a",
  fill: "rgba(26, 155, 122, 0.16)",
};

createApp({
  components: { MatchReport },
  setup() {
    const fixtures = ref([]);
    const results = ref([]);
    const nextMatch = ref(null);
    const source = ref("");
    const sourceUrl = ref("");
    const fetchedAt = ref("");
    const error = ref("");
    const loading = ref(true);
    const nextMatchesPref = ref(readFixtureSectionOpen(FIXTURES_NEXT_OPEN_KEY));
    const recentResultsPref = ref(readFixtureSectionOpen(FIXTURES_RESULTS_OPEN_KEY));
    const nextLiveChoice = ref(null);
    const resultsLiveChoice = ref(null);
    const sawPrematch = ref(false);
    const liveStatusKnown = ref(false);
    const nowMs = ref(Date.now());
    const liveMatch = ref(null);
    const liveError = ref("");
    const lastPlayedOpen = ref(false);
    const lastPlayedDismissed = ref(false);
    const lastPlayedPayload = ref(null);
    const lastPlayedLoading = ref(false);
    const lastPlayedError = ref("");
    const tableRanks = ref(new Map());
    let countdownTimer = null;
    let liveTimer = null;
    let liveRequest = 0;
    let livePollGeneration = 0;
    const LIVE_POLL_MS = 60_000;
    const ONGOING_CHECK_MS = 20_000;

    const fetchedLabel = computed(() => {
      if (!fetchedAt.value) return "";
      return new Date(fetchedAt.value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    });

    const nextMatchClock = computed(() =>
      countdownToKickoff(nextMatch.value?.kickoff, nowMs.value)
    );
    const kickoffDue = computed(() => Boolean(nextMatchClock.value?.due));
    const nextMatchStarted = computed(() => {
      const live = liveMatch.value;
      if (!kickoffDue.value || !live) return false;
      if (String(live.matchId || "") !== String(nextMatch.value?.id || "")) return false;
      return Boolean(live.ongoing || live.finished);
    });
    const nextMatchCountdown = computed(() => nextMatchClock.value?.label || "");
    const nextMatchCountdownCaption = computed(() => nextMatchClock.value?.caption || "");
    const liveFinished = computed(() => Boolean(liveMatch.value?.finished));
    const liveCancelled = computed(() => Boolean(liveMatch.value?.cancelled));
    const nextMatchHeading = computed(() => {
      if (!nextMatchStarted.value) return "Next match";
      if (liveFinished.value) return "Full time";
      if (liveCancelled.value) return "Cancelled";
      return "Live";
    });
    function lineupSidesFor(lineup) {
      if (!lineup?.home && !lineup?.away) return [];
      const ranks = tableRanks.value;
      return ["home", "away"]
        .filter((key) => lineup[key])
        .map((key) => {
          const side = lineup[key];
          return {
            key,
            ...side,
            tablePosition: lineupTablePosition(side, ranks),
          };
        });
    }

    function buildMatchReport({ idPrefix, heading, pinClock, includeKickoff, fixture, detail }) {
      const lineup =
        detail?.lineup && (detail.lineup.home || detail.lineup.away) ? detail.lineup : null;
      const home = fixture?.home || detail?.home || "Home";
      const away = fixture?.away || detail?.away || "Away";
      const homeScore = detail?.homeScore ?? 0;
      const awayScore = detail?.awayScore ?? 0;
      return {
        idPrefix,
        heading,
        live: heading === "Live",
        pinClock: Boolean(pinClock),
        matchId: String(detail?.matchId || fixture?.id || idPrefix),
        home,
        away,
        homeLogo: fixture?.homeLogo || "",
        awayLogo: fixture?.awayLogo || "",
        score: `${homeScore} – ${awayScore}`,
        status: detail?.statusLabel || "",
        goals: detail?.goals || [],
        events: detail?.events || [],
        stats: detail?.stats || [],
        statPeriods: detail?.statPeriods || [],
        homeName: detail?.home || home,
        awayName: detail?.away || away,
        lineup,
        lineupSides: lineupSidesFor(lineup),
        meta: nextMatchMetaLine(fixture, !includeKickoff),
      };
    }

    const liveReport = computed(() => {
      if (!nextMatchStarted.value || !liveMatch.value || !nextMatch.value) return null;
      return {
        ...buildMatchReport({
          idPrefix: "live",
          heading: nextMatchHeading.value,
          pinClock: true,
          includeKickoff: false,
          fixture: nextMatch.value,
          detail: liveMatch.value,
        }),
        expandAll: liveFinished.value,
      };
    });

    const canShowLastPlayed = computed(() => {
      if (loading.value || nextMatchStarted.value) return false;
      if (kickoffDue.value && !liveStatusKnown.value) return false;
      return true;
    });

    const lastPlayedInWindow = computed(() =>
      isWithinPostMatchWindow(lastPlayedPayload.value?.fixture?.kickoff, nowMs.value)
    );
    const lastPlayedReport = computed(() => {
      const payload = lastPlayedPayload.value;
      if (!canShowLastPlayed.value || !payload?.match || !payload?.fixture) return null;
      return {
        ...buildMatchReport({
          idPrefix: "last-played",
          heading: "Last played",
          pinClock: false,
          includeKickoff: true,
          fixture: payload.fixture,
          detail: payload.match,
        }),
        expandAll: true,
      };
    });
    const upcomingFixtures = computed(() => {
      const featured = nextMatch.value;
      if (!featured) return fixtures.value;
      return fixtures.value.filter((match) => !isSameFixture(match, featured));
    });
    const matchIsLive = computed(() => {
      const live = liveMatch.value;
      if (!live?.ongoing) return false;
      return String(live.matchId || "") === String(nextMatch.value?.id || "");
    });
    const liveMatchKey = computed(() =>
      matchIsLive.value ? String(liveMatch.value.matchId || "") : ""
    );
    const holdClosedForLiveCheck = computed(
      () =>
        kickoffDue.value &&
        !liveStatusKnown.value &&
        !sawPrematch.value &&
        Boolean(nextMatch.value?.id)
    );

    function sectionOpenDuringLive(choice) {
      return choice === true;
    }

    const nextMatchesOpen = computed(() => {
      if (matchIsLive.value || holdClosedForLiveCheck.value) {
        return sectionOpenDuringLive(nextLiveChoice.value);
      }
      return nextMatchesPref.value;
    });
    const recentResultsOpen = computed(() => {
      if (matchIsLive.value || holdClosedForLiveCheck.value) {
        return sectionOpenDuringLive(resultsLiveChoice.value);
      }
      return recentResultsPref.value;
    });

    function toggleLiveSection(section, choice, isOpen) {
      const matchId = matchIsLive.value
        ? liveMatchKey.value
        : holdClosedForLiveCheck.value
          ? String(nextMatch.value?.id || "")
          : "";
      if (!matchId) return false;
      const nextOpen = !isOpen;
      choice.value = nextOpen;
      storeFixtureSectionOpen(liveSectionOpenKey(section, matchId), nextOpen);
      return true;
    }

    function toggleNextMatches() {
      if (toggleLiveSection("next", nextLiveChoice, nextMatchesOpen.value)) return;
      nextMatchesPref.value = !nextMatchesPref.value;
      storeFixtureSectionOpen(FIXTURES_NEXT_OPEN_KEY, nextMatchesPref.value);
    }

    function toggleRecentResults() {
      if (toggleLiveSection("results", resultsLiveChoice, recentResultsOpen.value)) return;
      recentResultsPref.value = !recentResultsPref.value;
      storeFixtureSectionOpen(FIXTURES_RESULTS_OPEN_KEY, recentResultsPref.value);
    }

    watch(
      () => {
        if (matchIsLive.value) return liveMatchKey.value;
        if (holdClosedForLiveCheck.value) return String(nextMatch.value?.id || "");
        return "";
      },
      (id) => {
        if (!id) {
          nextLiveChoice.value = null;
          resultsLiveChoice.value = null;
          return;
        }
        nextLiveChoice.value = readStoredFlag(liveSectionOpenKey("next", id));
        resultsLiveChoice.value = readStoredFlag(liveSectionOpenKey("results", id));
      },
      { immediate: true }
    );

    watch(
      () => !loading.value && Boolean(nextMatch.value) && !kickoffDue.value,
      (prematch) => {
        if (prematch) sawPrematch.value = true;
      },
      { immediate: true }
    );

    watch(
      canShowLastPlayed,
      (show) => {
        if (show) loadLastPlayed();
      },
      { immediate: true }
    );

    watch(
      () => canShowLastPlayed.value && lastPlayedInWindow.value && !lastPlayedDismissed.value,
      (shouldOpen) => {
        if (shouldOpen) lastPlayedOpen.value = true;
      }
    );

    watch(lastPlayedInWindow, (inWindow, wasInWindow) => {
      if (wasInWindow && !inWindow) {
        lastPlayedOpen.value = false;
        lastPlayedDismissed.value = false;
      }
    });

    async function loadTableRanks() {
      try {
        const res = await fetch("/api/table/maccabi-haifa");
        if (!res.ok) return;
        const data = await res.json();
        tableRanks.value = tableRankMap(Array.isArray(data.rows) ? data.rows : []);
      } catch {
        // Lineup still renders when the table is unavailable.
      }
    }

    async function loadFixtures({ quiet = false } = {}) {
      if (!quiet) loading.value = true;
      try {
        const res = await fetch("/api/fixtures/maccabi-haifa");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        fixtures.value = Array.isArray(data.fixtures) ? data.fixtures : [];
        results.value = Array.isArray(data.results) ? data.results : [];
        nextMatch.value = data.nextMatch || fixtures.value[0] || null;
        source.value = data.source || "";
        sourceUrl.value = data.sourceUrl || "";
        fetchedAt.value = data.fetchedAt || "";
        error.value = "";
      } catch {
        if (!quiet) {
          error.value = "Could not load Maccabi Haifa fixtures.";
          fixtures.value = [];
          results.value = [];
          nextMatch.value = null;
        }
      } finally {
        if (!quiet) loading.value = false;
      }
    }

    function stopLivePolling() {
      livePollGeneration += 1;
      if (liveTimer) {
        clearTimeout(liveTimer);
        liveTimer = null;
      }
    }

    async function loadLiveMatch() {
      const matchId = nextMatch.value?.id;
      if (!matchId || !kickoffDue.value) return;
      const requestId = ++liveRequest;
      try {
        const res = await fetch(`/api/matches/${encodeURIComponent(matchId)}/live`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (requestId !== liveRequest) return;
        if (String(nextMatch.value?.id) !== String(matchId)) return;
        liveMatch.value = data;
        liveError.value = "";
        liveStatusKnown.value = true;
        if (data.finished || data.cancelled) {
          stopLivePolling();
          loadFixtures({ quiet: true });
        }
      } catch {
        if (requestId !== liveRequest) return;
        liveStatusKnown.value = true;
        if (!liveMatch.value?.ongoing) liveError.value = "";
      }
    }

    async function loadLastPlayed() {
      if (lastPlayedPayload.value || lastPlayedLoading.value) return;
      lastPlayedLoading.value = true;
      lastPlayedError.value = "";
      try {
        const res = await fetch("/api/matches/last-played");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (!data?.match || !data?.fixture) throw new Error("Incomplete last played mock");
        lastPlayedPayload.value = data;
      } catch {
        lastPlayedError.value = "Could not load the last played game.";
      } finally {
        lastPlayedLoading.value = false;
      }
    }

    function toggleLastPlayed() {
      lastPlayedOpen.value = !lastPlayedOpen.value;
      if (lastPlayedInWindow.value) lastPlayedDismissed.value = !lastPlayedOpen.value;
      if (lastPlayedOpen.value) loadLastPlayed();
    }

    function startLivePolling() {
      stopLivePolling();
      const generation = livePollGeneration;
      const tick = async () => {
        if (generation !== livePollGeneration) return;
        await loadLiveMatch();
        if (generation !== livePollGeneration) return;
        if (!kickoffDue.value || !nextMatch.value?.id) return;
        if (liveMatch.value?.finished || liveMatch.value?.cancelled) return;
        const wait = liveMatch.value?.ongoing ? LIVE_POLL_MS : ONGOING_CHECK_MS;
        liveTimer = setTimeout(tick, wait);
      };
      tick();
    }

    watch(
      () => (kickoffDue.value ? String(nextMatch.value?.id || "") : ""),
      (id) => {
        liveRequest += 1;
        stopLivePolling();
        liveMatch.value = null;
        liveError.value = "";
        liveStatusKnown.value = !id;
        if (!id) return;
        startLivePolling();
      }
    );

    onMounted(() => {
      loadFixtures();
      loadTableRanks();
      countdownTimer = setInterval(() => {
        nowMs.value = Date.now();
      }, 1000);
    });

    onBeforeUnmount(() => {
      if (countdownTimer) clearInterval(countdownTimer);
      liveRequest += 1;
      stopLivePolling();
    });

    return {
      fixtures,
      upcomingFixtures,
      results,
      nextMatch,
      source,
      sourceUrl,
      fetchedAt,
      fetchedLabel,
      error,
      loading,
      nextMatchStarted,
      nextMatchCountdown,
      nextMatchCountdownCaption,
      liveReport,
      canShowLastPlayed,
      lastPlayedOpen,
      lastPlayedLoading,
      lastPlayedError,
      lastPlayedReport,
      toggleLastPlayed,
      nextMatchMetaLine,
      fixtureCardMetaLine,
      resultCardMetaLine,
      nextMatchesOpen,
      recentResultsOpen,
      toggleNextMatches,
      toggleRecentResults,
    };
  },
}).mount("#fixtures-app");

createApp({
  setup() {
    const rows = ref([]);
    const leagueName = ref("");
    const sourceUrl = ref("");
    const fetchedAt = ref("");
    const legend = ref([]);
    const deductions = ref([]);
    const error = ref("");
    const loading = ref(true);

    const fetchedLabel = computed(() => {
      if (!fetchedAt.value) return "";
      return new Date(fetchedAt.value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    });

    async function loadTable() {
      loading.value = true;
      try {
        const res = await fetch("/api/table/maccabi-haifa");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        rows.value = Array.isArray(data.rows) ? data.rows : [];
        leagueName.value = data.leagueName || "League table";
        sourceUrl.value = data.sourceUrl || "";
        fetchedAt.value = data.fetchedAt || "";
        legend.value = Array.isArray(data.legend) ? data.legend : [];
        deductions.value = Array.isArray(data.deductions) ? data.deductions : [];
        error.value = "";
      } catch {
        error.value = "Could not load league table.";
        rows.value = [];
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => {
      loadTable();
    });

    return {
      rows,
      leagueName,
      sourceUrl,
      fetchedAt,
      fetchedLabel,
      legend,
      deductions,
      error,
      loading,
    };
  },
}).mount("#table-app");

createApp({
  template: document.getElementById("squad-template")?.innerHTML || "<p class=\"charts-error\">Squad view failed to load.</p>",
  setup() {
    const groups = ref([]);
    const sourceUrl = ref("");
    const fetchedAt = ref("");
    const playerCount = ref(0);
    const playerPhotoFallback = ref(
      "https://www.fotmob.com/img/player-fallback-light.png"
    );
    const error = ref("");
    const loading = ref(true);

    const fetchedLabel = computed(() => {
      if (!fetchedAt.value) return "";
      return new Date(fetchedAt.value).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
    });

    async function loadSquad() {
      loading.value = true;
      try {
        const res = await fetch("/api/squad/maccabi-haifa");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        groups.value = Array.isArray(data.groups)
          ? data.groups.map((group) => ({
              ...group,
              members: (group.members || []).map((member) => ({
                ...member,
                useOriginalPhoto: false,
              })),
            }))
          : [];
        sourceUrl.value = data.sourceUrl || "";
        fetchedAt.value = data.fetchedAt || "";
        playerCount.value = Number(data.playerCount) || 0;
        playerPhotoFallback.value =
          data.playerPhotoFallback || playerPhotoFallback.value;
        error.value = "";
      } catch {
        error.value = "Could not load Maccabi Haifa squad.";
        groups.value = [];
        playerCount.value = 0;
      } finally {
        loading.value = false;
      }
    }

    onMounted(() => {
      loadSquad();
    });

    function useOriginalPhoto(player, event) {
      const img = event?.target;
      if (!player || player.useOriginalPhoto) return;
      player.useOriginalPhoto = true;
      if (img) {
        img.onerror = null;
        img.src = player.photoOriginal || playerPhotoFallback.value;
      }
    }

    return {
      groups,
      sourceUrl,
      fetchedAt,
      fetchedLabel,
      playerCount,
      playerPhotoFallback,
      useOriginalPhoto,
      error,
      loading,
    };
  },
}).mount("#squad-app");

createApp({
  setup() {
    const month = ref("");
    const summary = ref(null);
    const error = ref("");
    const barCanvas = ref(null);
    const doughnutCanvas = ref(null);
    let barChart = null;
    let doughnutChart = null;

    function destroyCharts() {
      barChart?.destroy();
      doughnutChart?.destroy();
      barChart = null;
      doughnutChart = null;
    }

    function renderCharts(data) {
      destroyCharts();

      const labels = data.days.map((d) => d.label);
      const hours = data.days.map((d) => (d.hoursUp == null ? 0 : d.hoursUp));
      const barColors = data.days.map((d) => {
        if (d.status === "future") return chartColors.future;
        if (d.status === "up") return chartColors.up;
        if (d.status === "partial") return chartColors.partial;
        return chartColors.down;
      });

      barChart = new Chart(barCanvas.value, {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Hours up",
              data: hours,
              backgroundColor: barColors,
              borderWidth: 0,
              borderRadius: 4,
              maxBarThickness: 18,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title(items) {
                  return `Day ${items[0].label}`;
                },
                label(item) {
                  const day = data.days[item.dataIndex];
                  if (day.status === "future") return "Future day";
                  return `${item.parsed.y} hours up`;
                },
              },
            },
          },
          scales: {
            x: {
              title: { display: true, text: "Day of month", color: chartColors.muted },
              ticks: { color: chartColors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 16 },
              grid: { display: false },
            },
            y: {
              beginAtZero: true,
              max: 24,
              title: { display: true, text: "Hours", color: chartColors.muted },
              ticks: { color: chartColors.muted, stepSize: 6 },
              grid: { color: chartColors.grid },
            },
          },
        },
      });

      doughnutChart = new Chart(doughnutCanvas.value, {
        type: "doughnut",
        data: {
          labels: ["Fully up", "Partial", "Down / unknown"],
          datasets: [
            {
              data: [
                data.summary.daysUp,
                data.summary.daysPartial,
                data.summary.daysDown,
              ],
              backgroundColor: [chartColors.up, chartColors.partial, chartColors.down],
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

    async function loadMonth() {
      try {
        const res = await fetch("/api/uptime/month");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        month.value = data.month;
        summary.value = data.summary;
        error.value = "";
        await nextTick();
        renderCharts(data);
      } catch {
        error.value = "Could not load monthly uptime.";
        destroyCharts();
      }
    }

    onMounted(() => {
      loadMonth();
      window.addEventListener("app-view-change", onAppViewChange);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("app-view-change", onAppViewChange);
      destroyCharts();
    });

    function onAppViewChange(event) {
      if (event.detail?.view !== "more") return;
      window.setTimeout(() => {
        barChart?.resize();
        doughnutChart?.resize();
      }, 80);
    }

    return {
      month,
      summary,
      error,
      barCanvas,
      doughnutCanvas,
    };
  },
}).mount("#charts-app");

createApp({
  setup() {
    const samples = ref([]);
    const error = ref("");
    const ok = ref(true);
    const intervalSeconds = ref(60);
    const timeRangeHours = ref(12);
    const timeRangeUseAll = ref(false);
    const captureStartedAt = ref(null);
    const latencyCanvas = ref(null);
    let latencyChart = null;
    let timerId = null;
    let pingInFlight = false;
    const MAX_LOCAL_SAMPLES = 600;

    const timeRangeOptions = [
      { hours: 1, label: "1h" },
      { hours: 6, label: "6h" },
      { hours: 12, label: "12h" },
      { hours: 24, label: "1 day" },
      { hours: 48, label: "2 days" },
      { hours: 168, label: "7 days" },
    ];

    const isPresetTimeRange = computed(
      () =>
        !timeRangeUseAll.value &&
        timeRangeOptions.some((option) => option.hours === timeRangeHours.value)
    );

    const timeRangeSelectValue = computed(() => {
      if (timeRangeUseAll.value) return "all";
      const match = timeRangeOptions.find((option) => option.hours === timeRangeHours.value);
      return match ? String(match.hours) : "custom";
    });

    const captureStartedLabel = computed(() => {
      if (!captureStartedAt.value) return "";
      const date = new Date(captureStartedAt.value);
      if (Number.isNaN(date.getTime())) return "";
      const formatted = date.toLocaleString([], {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
      return timeRangeUseAll.value
        ? `Capturing since ${formatted}`
        : `Showing from ${formatted}`;
    });

    const intervalLabel = computed(() => {
      const seconds = intervalSeconds.value;
      if (seconds === 1) return "1 second";
      if (seconds < 60) return `${seconds} seconds`;
      if (seconds === 60) return "1 minute";
      const minutes = Math.floor(seconds / 60);
      const rem = seconds % 60;
      if (rem === 0) return `${minutes} minutes`;
      return `${minutes}m ${rem}s`;
    });

    const latestMs = computed(() => {
      const last = samples.value[samples.value.length - 1];
      if (!last || last.latencyMs == null) return "—";
      return `${last.latencyMs} ms`;
    });

    const latestLabel = computed(() => {
      const last = samples.value[samples.value.length - 1];
      if (!last) return "";
      if (last.latencyMs == null) return "unreachable";
      return `${last.latencyMs} ms`;
    });

    const averageMs = computed(() => {
      const values = samples.value
        .map((s) => s.latencyMs)
        .filter((v) => typeof v === "number");
      if (!values.length) return "—";
      const avg = values.reduce((sum, v) => sum + v, 0) / values.length;
      return `${Math.round(avg * 10) / 10} ms`;
    });

    const statusText = computed(() => (ok.value ? "Reachable" : "Unreachable"));

    function formatTime(iso) {
      const date = new Date(iso);
      if (timeRangeUseAll.value || timeRangeHours.value >= 24) {
        return date.toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      }
      return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: timeRangeHours.value <= 1 ? "2-digit" : undefined,
      });
    }

    function ensureChart() {
      if (latencyChart || !latencyCanvas.value) return;

      latencyChart = new Chart(latencyCanvas.value, {
        type: "line",
        data: {
          labels: [],
          datasets: [
            {
              label: "Latency (ms)",
              data: [],
              borderColor: chartColors.line,
              backgroundColor: chartColors.fill,
              borderWidth: 2,
              pointRadius: 2,
              pointHoverRadius: 5,
              pointBackgroundColor: chartColors.line,
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
                label(item) {
                  if (item.parsed.y == null) return "Unreachable";
                  return `${item.parsed.y} ms`;
                },
              },
            },
          },
          scales: {
            x: {
              title: { display: true, text: "Time", color: chartColors.muted },
              ticks: { color: chartColors.muted, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 },
              grid: { display: false },
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: "Latency (ms)", color: chartColors.muted },
              ticks: { color: chartColors.muted },
              grid: { color: chartColors.grid },
            },
          },
        },
      });
    }

    function renderSamples(nextSamples) {
      samples.value = nextSamples;
      const last = nextSamples[nextSamples.length - 1];
      if (last) {
        ok.value = last.ok;
        error.value = last.ok ? "" : "Ping failed";
      }

      ensureChart();
      if (!latencyChart) return;

      latencyChart.data.labels = nextSamples.map((s) => formatTime(s.at));
      latencyChart.data.datasets[0].data = nextSamples.map((s) => s.latencyMs);
      latencyChart.data.datasets[0].pointRadius = nextSamples.length > 80 ? 0 : 2;
      latencyChart.update();
    }

    function appendSample(sample) {
      if (timeRangeUseAll.value) {
        loadHistory();
        return;
      }

      const cutoff = Date.now() - timeRangeHours.value * 3600 * 1000;
      const next = [
        ...samples.value,
        {
          at: sample.at,
          latencyMs: sample.latencyMs ?? null,
          ok: Boolean(sample.ok),
        },
      ]
        .filter((entry) => new Date(entry.at).getTime() >= cutoff)
        .slice(-MAX_LOCAL_SAMPLES);

      renderSamples(next);
    }

    async function loadHistory() {
      try {
        const url = timeRangeUseAll.value
          ? "/api/ping/fotmob/history?all=1"
          : `/api/ping/fotmob/history?hours=${encodeURIComponent(timeRangeHours.value)}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        captureStartedAt.value = data.startedAt || null;
        renderSamples(Array.isArray(data.samples) ? data.samples : []);
        error.value = "";
      } catch {
        error.value = "Could not load latency history.";
        captureStartedAt.value = null;
      }
    }

    async function pingOnce() {
      if (pingInFlight) return;
      pingInFlight = true;

      try {
        const res = await fetch("/api/ping/fotmob");
        const data = await res.json();
        ok.value = Boolean(data.ok);
        error.value = data.ok ? "" : data.error || "Ping failed";
        if (data.at) {
          appendSample(data);
        } else {
          await loadHistory();
        }
      } catch {
        ok.value = false;
        error.value = "Could not reach ping API";
      } finally {
        pingInFlight = false;
      }
    }

    function restartTimer() {
      if (timerId) clearInterval(timerId);
      timerId = setInterval(pingOnce, intervalSeconds.value * 1000);
    }

    function onIntervalChange() {
      restartTimer();
    }

    function setTimeRange(hours) {
      timeRangeUseAll.value = false;
      timeRangeHours.value = hours;
      loadHistory();
    }

    function onTimeRangeSelect(event) {
      const value = event.target.value;
      if (value === "custom") return;
      if (value === "all") {
        timeRangeUseAll.value = true;
        loadHistory();
        return;
      }
      setTimeRange(Number(value));
    }

    function onTimeRangeChange() {
      timeRangeUseAll.value = false;
      loadHistory();
    }

    async function clearAll() {
      const DEFAULT_INTERVAL_SECONDS = 60;
      const DEFAULT_TIME_RANGE_HOURS = 12;

      try {
        await fetch("/api/ping/fotmob/history", { method: "DELETE" });
      } catch {
        // Still reset the UI even if the clear request fails.
      }

      intervalSeconds.value = DEFAULT_INTERVAL_SECONDS;
      timeRangeHours.value = DEFAULT_TIME_RANGE_HOURS;
      timeRangeUseAll.value = false;
      captureStartedAt.value = null;
      error.value = "";
      ok.value = true;
      renderSamples([]);
      restartTimer();
    }

    onMounted(async () => {
      await nextTick();
      ensureChart();
      await loadHistory();
      await pingOnce();
      restartTimer();
      window.addEventListener("app-view-change", onAppViewChange);
    });

    onBeforeUnmount(() => {
      window.removeEventListener("app-view-change", onAppViewChange);
      if (timerId) clearInterval(timerId);
      latencyChart?.destroy();
      latencyChart = null;
    });

    function onAppViewChange(event) {
      if (event.detail?.view !== "more") return;
      window.setTimeout(() => {
        latencyChart?.resize();
      }, 80);
    }

    return {
      samples,
      error,
      ok,
      intervalSeconds,
      intervalLabel,
      timeRangeHours,
      timeRangeUseAll,
      timeRangeOptions,
      isPresetTimeRange,
      timeRangeSelectValue,
      captureStartedAt,
      captureStartedLabel,
      latestMs,
      latestLabel,
      averageMs,
      statusText,
      latencyCanvas,
      onIntervalChange,
      onTimeRangeSelect,
      onTimeRangeChange,
      clearAll,
    };
  },
}).mount("#latency-app");
