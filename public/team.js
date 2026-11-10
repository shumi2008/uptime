// Selected team (Maccabi Haifa / AEK Athens). Loaded before every other script.
// Switching stores the choice and reloads so every view re-fetches for the new team.
(function initTeam() {
  const STORAGE_KEY = "uptime-team";
  const logo = (id) => `https://images.fotmob.com/image_resources/logo/teamlogo/${id}.png`;

  const TEAMS = {
    "maccabi-haifa": {
      slug: "maccabi-haifa",
      id: 10185,
      name: "Maccabi Haifa",
      shortName: "Haifa",
      leagueLabel: "Ligat ha'Al",
      foundedSeason: "1913/14",
      color: "#22b890",
      map: { lat: 31.75, lng: 34.85, zoom: 8, label: "Israel", minZoom: 6 },
    },
    "aek-athens": {
      slug: "aek-athens",
      id: 8563,
      name: "AEK Athens",
      shortName: "AEK",
      leagueLabel: "Super League",
      foundedSeason: "1924/25",
      color: "#f5c518",
      hero: {
        src: "https://help.ticketmaster.gr/hc/article_attachments/27917572269073",
        alt: "AEK Athens",
      },
      map: { lat: 38.6, lng: 23.3, zoom: 7, label: "Greece", minZoom: 5 },
    },
  };
  for (const t of Object.values(TEAMS)) t.logo = logo(t.id);

  function readSlug() {
    const fromUrl = new URLSearchParams(window.location.search).get("team");
    if (TEAMS[fromUrl]) return fromUrl;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (TEAMS[stored]) return stored;
    } catch {
      // Storage unavailable: fall back to the default team.
    }
    return "maccabi-haifa";
  }

  const current = TEAMS[readSlug()];
  try {
    localStorage.setItem(STORAGE_KEY, current.slug);
  } catch {
    // ignore
  }

  window.TEAMS = TEAMS;
  window.CURRENT_TEAM = current;
  window.teamApi = (resource) => `/api/${resource}/${current.slug}`;

  function switchTeam(slug) {
    if (!TEAMS[slug] || slug === current.slug) return;
    let persisted = false;
    try {
      localStorage.setItem(STORAGE_KEY, slug);
      persisted = localStorage.getItem(STORAGE_KEY) === slug;
    } catch {
      persisted = false;
    }
    const url = new URL(window.location.href);
    // When storage is blocked (private mode, some PWAs) carry the choice in the URL.
    if (persisted) url.searchParams.delete("team");
    else url.searchParams.set("team", slug);
    window.location.assign(url.toString());
  }
  window.switchTeam = switchTeam;

  function buildSwitcher(variant) {
    const wrap = document.createElement("div");
    wrap.className = `team-switch team-switch--${variant}`;
    wrap.setAttribute("role", "group");
    wrap.setAttribute("aria-label", "Followed team");
    for (const team of Object.values(TEAMS)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "team-switch__btn";
      btn.dataset.team = team.slug;
      btn.title = team.name;
      btn.setAttribute("aria-pressed", String(team.slug === current.slug));
      btn.innerHTML = `<img src="${team.logo}" alt="" width="22" height="22" decoding="async" /><span>${team.shortName}</span>`;
      btn.addEventListener("click", () => switchTeam(team.slug));
      wrap.appendChild(btn);
    }
    return wrap;
  }

  function applyToDom() {
    document.title = `Uptime · ${current.name}`;
    document.documentElement.dataset.team = current.slug;
    document.documentElement.style.setProperty("--team-accent", current.color);

    document
      .querySelectorAll("img[src*='teamlogo/10185.png'], .account-brand__logo")
      .forEach((img) => {
        img.src = current.logo;
        img.alt = current.name;
      });

    const stadium = document.getElementById("hero-stadium");
    if (stadium && current.hero) {
      stadium.src = current.hero.src;
      stadium.alt = current.hero.alt;
    }

    document.querySelectorAll("[data-team-name]").forEach((el) => {
      el.textContent = el.dataset.teamName === "short" ? current.shortName : current.name;
    });
    document.querySelectorAll("[data-team-league]").forEach((el) => {
      el.textContent = current.leagueLabel;
    });
    document.querySelectorAll("[data-team-founded]").forEach((el) => {
      el.textContent = current.foundedSeason;
    });

    const brand = document.getElementById("account-brand");
    if (brand && !brand.querySelector(".team-switch")) brand.appendChild(buildSwitcher("desktop"));
    const mobileBrand = document.querySelector(".mobile-chrome__brand");
    if (mobileBrand && !mobileBrand.querySelector(".team-switch")) {
      mobileBrand.appendChild(buildSwitcher("mobile"));
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", applyToDom);
  } else {
    applyToDom();
  }
})();
