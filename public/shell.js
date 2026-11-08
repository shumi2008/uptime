(function initAppShell() {
  const COMPACT_QUERY = "(max-width: 640px)";
  const TOUCH_QUERY = "(hover: none) and (pointer: coarse)";
  const STANDALONE_QUERY = "(display-mode: standalone), (display-mode: fullscreen)";

  const compactMq = window.matchMedia(COMPACT_QUERY);
  const touchMq = window.matchMedia(TOUCH_QUERY);
  const standaloneMq = window.matchMedia(STANDALONE_QUERY);

  const VIEW_IDS = ["home", "fixtures", "table", "squad", "map", "more"];
  const VIEW_TARGETS = {
    home: "home",
    fixtures: "fixtures",
    table: "league-table",
    squad: "squad",
    map: "location-map",
    more: "monthly-uptime",
  };
  const HASH_TO_VIEW = {
    home: "home",
    fixtures: "fixtures",
    "league-table": "table",
    squad: "squad",
    "club-history": "map",
    "location-map": "map",
    "monthly-uptime": "more",
    "fotmob-latency": "more",
    users: "more",
    learn: "more",
  };

  let activeView = "home";

  function isStandalone() {
    return standaloneMq.matches || window.navigator.standalone === true;
  }

  function isCompact() {
    return compactMq.matches;
  }

  function isTouch() {
    return touchMq.matches;
  }

  function usesAppShell() {
    return isCompact() || isStandalone();
  }

  function applyDeviceClasses() {
    const root = document.documentElement;
    const appShell = usesAppShell();
    root.classList.toggle("is-compact", isCompact());
    root.classList.toggle("is-touch", isTouch());
    root.classList.toggle("is-standalone", isStandalone());
    root.classList.toggle("is-app-shell", appShell);
    document.body.classList.toggle("is-app-shell", appShell);
    root.classList.add("is-app-shell-ready");
  }

  function viewFromHash() {
    const hash = window.location.hash.replace(/^#/, "");
    if (!hash) return null;
    return HASH_TO_VIEW[hash] || null;
  }

  function readStoredView() {
    try {
      const stored = sessionStorage.getItem("uptime-app-view");
      return VIEW_IDS.includes(stored) ? stored : null;
    } catch {
      return null;
    }
  }

  function storeView(view) {
    try {
      sessionStorage.setItem("uptime-app-view", view);
    } catch {
      // Ignore storage errors in private mode.
    }
  }

  function updateTabUi(view) {
    document.querySelectorAll(".app-tabs__btn").forEach((btn) => {
      const btnView = btn.getAttribute("data-app-view");
      const isActive = btnView === view;
      btn.classList.toggle("is-active", isActive);
      btn.setAttribute("aria-current", isActive ? "page" : "false");
    });

    const tabs = document.getElementById("app-tabs");
    if (tabs) tabs.hidden = !usesAppShell();

    const mobileChrome = document.getElementById("mobile-chrome");
    if (mobileChrome) mobileChrome.hidden = !usesAppShell();
  }

  function scrollToView(view, { behavior = "smooth", targetId = null } = {}) {
    const id = targetId || VIEW_TARGETS[view] || "home";
    const el = document.getElementById(id);
    if (!el) return;

    el.scrollIntoView({
      behavior,
      block: "start",
    });
  }

  function setActiveView(view, { updateHash = true, scroll = true } = {}) {
    if (!VIEW_IDS.includes(view)) view = "home";
    activeView = view;
    storeView(view);
    updateTabUi(view);

    if (updateHash) {
      const hashByView = {
        home: "",
        fixtures: "fixtures",
        table: "league-table",
        squad: "squad",
        map: "location-map",
        more: "monthly-uptime",
      };
      const nextHash = hashByView[view] ? `#${hashByView[view]}` : "";
      const currentHash = `#${window.location.hash.replace(/^#/, "")}`;
      if (currentHash !== nextHash) {
        history.replaceState(null, "", nextHash || window.location.pathname);
      }
    }

    if (scroll && usesAppShell()) {
      const hash = window.location.hash.replace(/^#/, "");
      const hashTarget =
        hash && HASH_TO_VIEW[hash] === view && document.getElementById(hash)
          ? hash
          : null;
      scrollToView(view, { behavior: "auto", targetId: hashTarget });
    }

    window.dispatchEvent(new CustomEvent("app-view-change", { detail: { view } }));
  }

  function syncShellLayout() {
    applyDeviceClasses();

    if (!usesAppShell()) {
      const tabs = document.getElementById("app-tabs");
      if (tabs) tabs.hidden = true;
      const mobileChrome = document.getElementById("mobile-chrome");
      if (mobileChrome) mobileChrome.hidden = true;
      return;
    }

    const hashView = viewFromHash();
    const storedView = readStoredView();
    setActiveView(hashView || storedView || activeView, {
      updateHash: !hashView,
      scroll: Boolean(hashView),
    });
  }

  function setupTabs() {
    const tabs = document.getElementById("app-tabs");
    if (!tabs) return;

    tabs.addEventListener("click", (event) => {
      const btn = event.target.closest(".app-tabs__btn");
      if (!btn) return;
      const view = btn.getAttribute("data-app-view");
      if (!view) return;
      setActiveView(view);
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // Install prompt still works on some browsers without SW.
      });
    });
  }

  compactMq.addEventListener("change", syncShellLayout);
  standaloneMq.addEventListener("change", syncShellLayout);
  window.addEventListener("hashchange", () => {
    if (!usesAppShell()) return;
    const hashView = viewFromHash();
    if (hashView) setActiveView(hashView, { updateHash: false });
  });

  setupTabs();
  applyDeviceClasses();
  syncShellLayout();
  registerServiceWorker();
})();
