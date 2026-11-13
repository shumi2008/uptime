(function initClubHistoryChart() {
  const section = document.getElementById("club-history");
  const canvas = document.getElementById("haifa-history-chart");
  const statusEl = document.getElementById("club-history-status");
  const summaryEl = document.getElementById("club-history-summary");

  if (!section || !canvas || typeof Chart === "undefined") return;

  const colors = {
    line: window.CURRENT_TEAM?.slug === "aek-athens" ? "#d4a90f" : "#1a9b7a",
    fill:
      window.CURRENT_TEAM?.slug === "aek-athens"
        ? "rgba(245, 197, 24, 0.38)"
        : "rgba(26, 155, 122, 0.38)",
    muted: "#4a6360",
    grid: "rgba(12, 26, 31, 0.08)",
    champion: "#e8c547",
    strong: "#1a9b7a",
    weak: "#8a3b2b",
    loss: "#d33a2c",
    default: "#6b8f84",
  };

  const TOP_RANK_MARGIN = 2;

  let chart = null;
  let loaded = false;
  let seasonRows = [];

  function seasonStartYear(season) {
    const match = String(season).match(/^(\d{4})/);
    return match ? Number(match[1]) : null;
  }

  function formatSeasonShort(season, startYear) {
    const raw = String(season || "").trim();
    const four = raw.match(/^(\d{4})[/-](\d{2,4})$/);
    if (four) {
      const end = four[2].length === 4 ? four[2].slice(2) : four[2];
      return `${four[1].slice(2)}/${end}`;
    }
    if (startYear != null) {
      const sy = startYear % 100;
      const ey = (startYear + 1) % 100;
      return `${String(sy).padStart(2, "0")}/${String(ey).padStart(2, "0")}`;
    }
    return raw;
  }

  function pointColor(position) {
    if (position === 1) return colors.champion;
    if (position <= 3) return colors.strong;
    if (position >= 10) return colors.weak;
    return colors.default;
  }

  function ordinal(n) {
    const v = Number(n);
    const mod100 = v % 100;
    if (mod100 >= 11 && mod100 <= 13) return "th";
    const mod10 = v % 10;
    if (mod10 === 1) return "st";
    if (mod10 === 2) return "nd";
    if (mod10 === 3) return "rd";
    return "th";
  }

  function destroyChart() {
    if (chart) {
      chart.destroy();
      chart = null;
    }
  }

  function prepareSeasonRows(seasons) {
    return seasons
      .map((row) => {
        const year = seasonStartYear(row.season);
        return {
          ...row,
          year,
          seasonShort: formatSeasonShort(row.season, year),
        };
      })
      .filter((row) => row.year != null)
      .sort((a, b) => a.year - b.year);
  }

  function rowsForChart(allRows) {
    const firstResultIndex = allRows.findIndex((row) => row.position != null);
    if (firstResultIndex === -1) return [];
    return allRows.slice(firstResultIndex);
  }

  function renderChart(rows) {
    destroyChart();
    seasonRows = rows;

    if (!rows.length) {
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = "No season history available.";
      }
      return;
    }

    const labels = rows.map((row) => row.seasonShort);
    const positions = rows.map((row) =>
      row.position == null ? null : row.position
    );
    const maxPos = Math.max(
      ...positions.filter((value) => typeof value === "number"),
      14
    );

    const pointColors = rows.map((row) =>
      row.position == null ? "transparent" : pointColor(row.position)
    );

    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "League finish",
            data: positions,
            borderColor: colors.line,
            backgroundColor: colors.fill,
            borderWidth: 2,
            tension: 0.25,
            fill: {
              target: maxPos,
            },
            pointRadius: rows.map((row) => (row.position == null ? 0 : 3)),
            pointHoverRadius: rows.map((row) => (row.position == null ? 0 : 5)),
            pointBackgroundColor: pointColors,
            pointBorderColor: pointColors,
            spanGaps: true,
            segment: {
              // Position number going up = finished lower = lost ground.
              borderColor(ctx) {
                const from = ctx.p0.parsed.y;
                const to = ctx.p1.parsed.y;
                return to > from ? colors.loss : undefined;
              },
            },
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 400 },
        interaction: { mode: "nearest", axis: "x", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            filter(item) {
              return seasonRows[item.dataIndex]?.position != null;
            },
            callbacks: {
              title(items) {
                const row = seasonRows[items[0]?.dataIndex];
                return row ? row.seasonShort : items[0]?.label || "";
              },
              label(item) {
                const row = seasonRows[item.dataIndex];
                const suffix = row?.inProgress ? " (in progress)" : "";
                const division = row?.division ? ` — ${row.division}` : "";
                return `${item.formattedValue}${ordinal(item.raw)} place${suffix}${division}`;
              },
            },
          },
        },
        scales: {
          x: {
            type: "category",
            title: { display: true, text: "Season", color: colors.muted },
            ticks: {
              color: colors.muted,
              maxRotation: 45,
              minRotation: 45,
              autoSkip: true,
              maxTicksLimit: 24,
            },
            grid: { display: false },
          },
          y: {
            type: "linear",
            min: 1 - TOP_RANK_MARGIN,
            max: maxPos,
            reverse: true,
            title: { display: true, text: "League position", color: colors.muted },
            ticks: {
              color: colors.muted,
              stepSize: 1,
              precision: 0,
              callback(value) {
                if (value < 1) return "";
                return value;
              },
            },
            grid: {
              color: colors.grid,
              drawTicks: true,
            },
          },
        },
      },
    });
  }

  async function loadHistory() {
    if (statusEl) statusEl.textContent = "Loading club history…";
    try {
      const res = await fetch(teamApi("history"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const seasons = Array.isArray(data.seasons) ? data.seasons : [];
      const allRows = prepareSeasonRows(seasons);
      const rows = rowsForChart(allRows);
      if (!rows.length) throw new Error("No seasons with results");

      const first = rows[0]?.seasonShort;
      const last = rows[rows.length - 1]?.seasonShort;
      const withTable =
        data.chartedSeasons ?? allRows.filter((r) => r.position != null).length;

      if (summaryEl) {
        summaryEl.textContent = `Chart from first recorded league finish (${first}) through ${last}. ${withTable} seasons with a table position in the full club history. ${data.titles ?? 0} top-flight titles. Filled area shows finish over time; 1st place sits below the top margin.`;
      }

      renderChart(rows);
      if (statusEl) statusEl.hidden = true;
      loaded = true;
    } catch {
      destroyChart();
      if (statusEl) {
        statusEl.hidden = false;
        statusEl.textContent = "Could not load league history.";
      }
    }
  }

  function onViewChange(event) {
    if (event.detail?.view !== "more" && event.detail?.view !== "history") return;
    if (!loaded) loadHistory();
    else if (chart) chart.resize();
  }

  window.addEventListener("app-view-change", onViewChange);

  if (!document.documentElement.classList.contains("is-app-shell")) {
    loadHistory();
  } else if ("IntersectionObserver" in window) {
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          loadHistory();
          observer.disconnect();
        }
      },
      { rootMargin: "120px" }
    );
    observer.observe(section);
  } else {
    loadHistory();
  }
})();
