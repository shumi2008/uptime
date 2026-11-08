function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function randomInt(min, max) {
  return Math.floor(randomBetween(min, max + 1));
}

const HERO_SIGNAL_MIN = 10;
const HERO_SIGNAL_MAX = 18;
let heroSignalTargetCount = randomInt(HERO_SIGNAL_MIN, HERO_SIGNAL_MAX);

function rectsOverlap(a, b, padding = 0) {
  return !(
    a.right + padding < b.left ||
    a.left - padding > b.right ||
    a.bottom + padding < b.top ||
    a.top - padding > b.bottom
  );
}

function placeHeroLogo() {
  const logo = document.getElementById("hero-logo");
  if (!logo) return;

  const avoidEl = document.querySelector(".login-card");
  if (avoidEl || logo.closest(".hero--login")) {
    logo.style.top = "";
    logo.style.left = "";
    return;
  }

  const mobile = window.matchMedia("(max-width: 640px)").matches;
  const topRange = mobile ? [4, 38] : [5, 68];
  const leftRange = mobile ? [4, 72] : [5, 82];

  function applyPosition(topPct, leftPct) {
    logo.style.top = `${topPct.toFixed(1)}%`;
    logo.style.left = `${leftPct.toFixed(1)}%`;
  }

  if (!avoidEl) {
    applyPosition(randomBetween(...topRange), randomBetween(...leftRange));
    return;
  }

  for (let attempt = 0; attempt < 40; attempt++) {
    applyPosition(randomBetween(...topRange), randomBetween(...leftRange));
    const logoRect = logo.getBoundingClientRect();
    const avoidRect = avoidEl.getBoundingClientRect();
    if (!rectsOverlap(logoRect, avoidRect, 28)) {
      return;
    }
  }

  const fallbacks = mobile
    ? [
        [8, 8],
        [8, 72],
        [6, 12],
      ]
    : [
        [10, 8],
        [12, 78],
        [8, 12],
        [15, 82],
      ];
  const [top, left] = fallbacks[randomInt(0, fallbacks.length - 1)];
  applyPosition(top, left);
}

function createHeroSignalElement(mobile) {
  const signal = document.createElement("div");
  signal.className = "hero__signal";

  const size = mobile ? randomBetween(40, 72) : randomBetween(52, 100);
  const delay = randomBetween(0, 2.4);
  const duration = randomBetween(2.4, 4.2);
  const opacity = randomBetween(0.45, 1);

  signal.style.width = `${size.toFixed(0)}px`;
  signal.style.height = `${size.toFixed(0)}px`;
  signal.style.setProperty("--pulse-delay", `${delay.toFixed(2)}s`);
  signal.style.setProperty("--pulse-duration", `${duration.toFixed(2)}s`);
  signal.style.setProperty("--signal-opacity", opacity.toFixed(2));

  signal.innerHTML =
    '<span class="pulse"></span><span class="pulse pulse--delay"></span><span class="line"></span>';
  return signal;
}

function placeHeroSignals(explicitCount) {
  const container = document.getElementById("hero-signals");
  if (!container || document.getElementById("hero-visual")) return;

  const mobile = window.matchMedia("(max-width: 640px)").matches;
  const count = explicitCount ?? randomInt(1, 10);
  const fullSpread = explicitCount != null;
  container.replaceChildren();

  for (let i = 0; i < count; i++) {
    const signal = createHeroSignalElement(mobile);

    const top = fullSpread
      ? randomBetween(mobile ? 6 : 8, mobile ? 88 : 90)
      : mobile
        ? randomBetween(6, 42)
        : randomBetween(8, 72);
    const left = fullSpread
      ? randomBetween(mobile ? 4 : 5, 92)
      : mobile
        ? randomBetween(48, 92)
        : randomBetween(42, 92);

    signal.style.top = `${top.toFixed(1)}%`;
    signal.style.left = `${left.toFixed(1)}%`;

    container.appendChild(signal);
  }
}

function getStadiumRectInContainer(stadium, container) {
  const containerRect = container.getBoundingClientRect();
  const stadiumRect = stadium.getBoundingClientRect();

  return {
    containerRect,
    stadiumRect,
    stadiumInContainer: {
      left: stadiumRect.left - containerRect.left,
      top: stadiumRect.top - containerRect.top,
      right: stadiumRect.right - containerRect.left,
      bottom: stadiumRect.bottom - containerRect.top,
      width: stadiumRect.width,
      height: stadiumRect.height,
    },
  };
}

function getStadiumCenterPct(containerRect, stadiumRect) {
  return {
    cx:
      ((stadiumRect.left + stadiumRect.width / 2 - containerRect.left) / containerRect.width) *
      100,
    cy:
      ((stadiumRect.top + stadiumRect.height / 2 - containerRect.top) / containerRect.height) *
      100,
  };
}

function getHeroSignalLayout() {
  const container = document.getElementById("hero-signals");
  const stadium = document.getElementById("hero-stadium");
  if (!container || !stadium) return null;

  const layout = getStadiumRectInContainer(stadium, container);
  if (!layout.containerRect.width || !layout.containerRect.height) {
    return null;
  }

  const center = getStadiumCenterPct(layout.containerRect, layout.stadiumRect);
  return {
    container,
    layout,
    bounds: {
      containerRect: layout.containerRect,
      cx: center.cx,
      cy: center.cy,
    },
  };
}

function distancePointToRect(px, py, rect) {
  const dx = Math.max(rect.left - px, 0, px - rect.right);
  const dy = Math.max(rect.top - py, 0, py - rect.bottom);
  return Math.hypot(dx, dy);
}

function isSignalPositionValid(
  signalSize,
  topPct,
  leftPct,
  containerRect,
  stadiumInContainer,
  { relaxed = false } = {}
) {
  const px = (leftPct / 100) * containerRect.width;
  const py = (topPct / 100) * containerRect.height;
  const pulseRadius = (signalSize / 2) * 1.18;
  const margin = relaxed ? signalSize * 0.45 : signalSize;
  const minDistance = pulseRadius + margin;

  return distancePointToRect(px, py, stadiumInContainer) >= minDistance;
}

function pickSignalPosition(signal, bounds, stadiumInContainer, options = {}) {
  const size = parseFloat(signal.style.width) || 80;
  const { containerRect } = bounds;
  const minDist =
    (size / 2) * 1.18 + (options.relaxed ? size * 0.45 : size);

  for (let attempt = 0; attempt < 96; attempt++) {
    const top = randomBetween(5, 95);
    const left = randomBetween(5, 95);

    if (
      isSignalPositionValid(size, top, left, containerRect, stadiumInContainer, options)
    ) {
      return { top, left, ok: true };
    }
  }

  const cx = (stadiumInContainer.left + stadiumInContainer.right) / 2;
  const cy = (stadiumInContainer.top + stadiumInContainer.bottom) / 2;
  const ringX = stadiumInContainer.width / 2 + minDist;
  const ringY = stadiumInContainer.height / 2 + minDist;

  for (let attempt = 0; attempt < 96; attempt++) {
    const angle = randomBetween(0, Math.PI * 2);
    const scale = randomBetween(1.02, 1.35);
    const px = cx + Math.cos(angle) * ringX * scale;
    const py = cy + Math.sin(angle) * ringY * scale;
    const left = (px / containerRect.width) * 100;
    const top = (py / containerRect.height) * 100;

    if (top < 5 || top > 95 || left < 5 || left > 95) {
      continue;
    }

    if (
      isSignalPositionValid(size, top, left, containerRect, stadiumInContainer, options)
    ) {
      return { top, left, ok: true };
    }
  }

  return { ok: false };
}

function applySignalPosition(signal, position) {
  signal.style.top = `${position.top.toFixed(1)}%`;
  signal.style.left = `${position.left.toFixed(1)}%`;
}

function revealHeroSignal(signal) {
  signal.classList.remove("is-leaving");
  signal.classList.add("is-live");
}

function runHeroSignalPlacement() {
  window.requestAnimationFrame(() => {
    placeHeroSignalsAroundStadium();
  });
}

function hideHeroSignal(signal, onDone) {
  signal.classList.remove("is-live");
  signal.classList.add("is-leaving");
  window.setTimeout(() => {
    signal.remove();
    onDone?.();
  }, 520);
}

function addHeroSignalAtNewPosition(state, options = {}) {
  const liveCount = state.container.querySelectorAll(".hero__signal").length;
  if (liveCount >= heroSignalTargetCount) {
    return false;
  }

  const mobile = window.matchMedia("(max-width: 640px)").matches;
  const signal = createHeroSignalElement(mobile);
  const position = pickSignalPosition(
    signal,
    state.bounds,
    state.layout.stadiumInContainer,
    options
  );
  if (!position.ok) return false;

  applySignalPosition(signal, position);
  state.container.appendChild(signal);
  revealHeroSignal(signal);
  return true;
}

function repositionHeroSignal(state) {
  const signals = [...state.container.querySelectorAll(".hero__signal")];
  if (!signals.length) return;

  const signal = signals[randomInt(0, signals.length - 1)];
  const size = parseFloat(signal.style.width) || 80;
  const position = pickSignalPosition(
    { style: { width: String(size) } },
    state.bounds,
    state.layout.stadiumInContainer
  );
  if (!position.ok) return;

  signal.classList.remove("is-live");
  signal.classList.add("is-leaving");

  window.setTimeout(() => {
    if (!signal.isConnected) return;
    applySignalPosition(signal, position);
    signal.classList.remove("is-leaving");
    revealHeroSignal(signal);
  }, 520);
}

function removeRandomHeroSignal(state) {
  const signals = [...state.container.querySelectorAll(".hero__signal")];
  if (signals.length <= HERO_SIGNAL_MIN) return;

  const signal = signals[randomInt(0, signals.length - 1)];
  hideHeroSignal(signal);
}

function tickHeroSignals() {
  const state = getHeroSignalLayout();
  if (!state) return;

  const signals = [...state.container.querySelectorAll(".hero__signal")];
  const roll = Math.random();

  if (signals.length < HERO_SIGNAL_MIN) {
    addHeroSignalAtNewPosition(state) ||
      addHeroSignalAtNewPosition(state, { relaxed: true });
    return;
  }

  if (signals.length < heroSignalTargetCount && roll < 0.45) {
    addHeroSignalAtNewPosition(state);
  } else if (roll < 0.75) {
    repositionHeroSignal(state);
  } else if (signals.length > HERO_SIGNAL_MIN && signals.length > heroSignalTargetCount) {
    removeRandomHeroSignal(state);
  } else if (signals.length < heroSignalTargetCount) {
    addHeroSignalAtNewPosition(state);
  } else {
    repositionHeroSignal(state);
  }
}

function fillHeroSignalsToTarget(state) {
  let attempts = 0;
  const maxAttempts = heroSignalTargetCount * 12;

  while (
    state.container.querySelectorAll(".hero__signal").length < heroSignalTargetCount &&
    attempts < maxAttempts
  ) {
    const added =
      addHeroSignalAtNewPosition(state) ||
      addHeroSignalAtNewPosition(state, { relaxed: true });
    if (!added) {
      attempts += 1;
    } else {
      attempts = 0;
    }
  }

  attempts = 0;
  while (
    state.container.querySelectorAll(".hero__signal").length < HERO_SIGNAL_MIN &&
    attempts < maxAttempts
  ) {
    attempts += 1;
    const added =
      addHeroSignalAtNewPosition(state, { relaxed: true }) ||
      addHeroSignalAtNewPosition(state);
    if (!added && attempts > 8) break;
  }
}

function placeHeroSignalsAroundStadium() {
  const state = getHeroSignalLayout();
  if (!state) return;

  heroSignalTargetCount = randomInt(HERO_SIGNAL_MIN, HERO_SIGNAL_MAX);
  state.container.replaceChildren();
  fillHeroSignalsToTarget(state);
}

function cycleHeroSignalsAroundStadium() {
  placeHeroSignalsAroundStadium();
}

function initMainPageHero() {
  const visual = document.getElementById("hero-visual");
  if (!visual) return;

  const stadium = document.getElementById("hero-stadium");

  if (stadium?.complete) {
    runHeroSignalPlacement();
  } else if (stadium) {
    stadium.addEventListener("load", runHeroSignalPlacement, { once: true });
    runHeroSignalPlacement();
  } else {
    runHeroSignalPlacement();
  }

  window.setInterval(tickHeroSignals, 1400);

  let resizeTimer;
  window.addEventListener("resize", () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(runHeroSignalPlacement, 180);
  });
}
