(() => {
  "use strict";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = (arr) => arr[randInt(0, arr.length - 1)];
  const now = () => performance.now();

  // ---------- Setup ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const approvalEl = document.getElementById("approval");
  const warriskEl = document.getElementById("warrisk");
  const modeBtn = document.getElementById("modeBtn");
  const newMapBtn = document.getElementById("newMapBtn");
  const outpostBtn = document.getElementById("outpostBtn");
  const bannerEl = document.getElementById("banner");
  const legendEl = document.getElementById("legend");
  const toastEl = document.getElementById("toast");
  const introEl = document.getElementById("intro");
  const startBtn = document.getElementById("startBtn");
  const startZenBtn = document.getElementById("startZenBtn");
  const chronicleBtn = document.getElementById("chronicleBtn");
  const chronicleOverlay = document.getElementById("chronicleOverlay");
  const chronicleList = document.getElementById("chronicleList");
  const chronicleCloseBtn = document.getElementById("chronicleCloseBtn");
  const choiceOverlay = document.getElementById("choiceOverlay");
  const choiceTitle = document.getElementById("choiceTitle");
  const choiceText = document.getElementById("choiceText");
  const choiceOptions = document.getElementById("choiceOptions");
  const inspectorOverlay = document.getElementById("inspectorOverlay");
  const inspectorName = document.getElementById("inspectorName");
  const inspectorTier = document.getElementById("inspectorTier");
  const inspectorTrade = document.getElementById("inspectorTrade");
  const inspectorUpgrade = document.getElementById("inspectorUpgrade");
  const inspectorCloseBtn = document.getElementById("inspectorCloseBtn");

  let W = 0, H = 0, DPR = 1;
  let texture = null;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    buildTexture();
  }
  function buildTexture() {
    texture = document.createElement("canvas");
    texture.width = W; texture.height = H;
    const tctx = texture.getContext("2d");
    const g = tctx.createRadialGradient(W * 0.5, H * 0.4, 0, W * 0.5, H * 0.4, Math.max(W, H) * 0.75);
    g.addColorStop(0, "#f1e6c6");
    g.addColorStop(0.75, "#ece0bc");
    g.addColorStop(1, "#d6c393");
    tctx.fillStyle = g;
    tctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 700; i++) {
      const x = Math.random() * W, y = Math.random() * H;
      tctx.fillStyle = Math.random() < 0.5 ? "#3b2a1a" : "#f7efd6";
      tctx.globalAlpha = Math.random() * 0.035;
      tctx.beginPath();
      tctx.arc(x, y, rand(0.5, 1.6), 0, Math.PI * 2);
      tctx.fill();
    }
    tctx.globalAlpha = 1;
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Resources ----------
  const RESOURCES = [
    { id: "grain", name: "Grain", color: "#b3821f" },
    { id: "timber", name: "Timber", color: "#4b6b3a" },
    { id: "ore", name: "Ore", color: "#5c5c6e" },
    { id: "cloth", name: "Cloth", color: "#8f3f61" },
    { id: "spice", name: "Spice", color: "#a85a22" },
    { id: "tools", name: "Tools", color: "#3f6d7a" }
  ];
  const RES = Object.fromEntries(RESOURCES.map(r => [r.id, r]));

  const NAME_PREFIX = ["River", "Stone", "Oak", "Iron", "Salt", "Wolf", "Thorn", "Ash", "Black", "Storm", "Elder", "Bright"];
  const NAME_SUFFIX = ["ford", "haven", "hold", "mere", "wick", "burg", "reach", "fall", "gate", "moor", "crest", "vale"];

  function renderLegend() {
    legendEl.innerHTML = "";
    RESOURCES.forEach(r => {
      const chip = document.createElement("div");
      chip.className = "legend-chip";
      chip.innerHTML = `<span class="legend-dot" style="background:${r.color}"></span>${r.name}`;
      legendEl.appendChild(chip);
    });
  }
  renderLegend();

  function segIntersect(p1, p2, p3, p4) {
    const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
    const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
    const denom = d1x * d2y - d1y * d2x;
    if (Math.abs(denom) < 1e-9) return null;
    const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
    const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / denom;
    if (t > 0.02 && t < 0.98 && u > 0.02 && u < 0.98) {
      return { x: p1.x + t * d1x, y: p1.y + t * d1y };
    }
    return null;
  }

  function distToSeg(p, a, b) {
    const l2 = dist(a, b) ** 2;
    if (l2 === 0) return dist(p, a);
    let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
    t = clamp(t, 0, 1);
    const proj = { x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) };
    return dist(p, proj);
  }

  // ---------- Tunables ----------
  const WAR_WARN_MS = 8000;
  const BLOCKADE_MS = 45000;
  const DAY_LENGTH_MS = 26000;
  const STRAIN_GRACE_MS = 18000;
  const HARVEST_MS = 40000;
  const BLIGHT_MS = 50000;
  const STARTING_PROSPERITY = 60;
  const BASE_INCOME = 2;
  const FOUND_COST = 50;
  const UPGRADE_TOWN_COST = 110;
  const UPGRADE_CITY_COST = 220;

  // ---------- Game state ----------
  let mode = "trade"; // 'trade' | 'zen'
  let settlements = [];
  let edges = [];
  let pairCooldown = new Map();
  let particles = [];
  let sparks = [];
  let score = 0;
  let best = Number(localStorage.getItem("constellate_best") || 0);
  let approval = 50;
  let warRisk = 20;
  let dragFrom = null;
  let dragPos = null;
  let dragStartPos = null;
  let hoverSettlement = null;
  let lastTick = now();
  let mapMinDist = 60;
  let started = false;
  let paused = false;
  let usedNames = new Set();
  let nextId = 0;

  let activeWar = null; // {a, b, edge|null, warnUntil}
  let activeChoice = null;
  let inspecting = null;

  let placingOutpost = false;

  const chronicle = [];
  let dayCount = 1;
  let lastDayAt = now();
  let lastChoiceDay = 0;

  bestEl.textContent = "best reign: " + best;

  function keyFor(i, j) { return i < j ? `${i}-${j}` : `${j}-${i}`; }

  function logChronicle(text) {
    chronicle.unshift({ day: dayCount, text });
    if (chronicle.length > 40) chronicle.pop();
  }

  // ---------- Settlement factory ----------
  function randomTownName() {
    let name;
    do { name = pick(NAME_PREFIX) + pick(NAME_SUFFIX); } while (usedNames.has(name));
    usedNames.add(name);
    return name;
  }

  function randomNeeds(produces, count) {
    const needs = [];
    while (needs.length < count) {
      const r = pick(RESOURCES).id;
      if (r !== produces && !needs.includes(r)) needs.push(r);
    }
    return needs;
  }

  function makeTown(x, y, { population = randInt(1, 2), needCount = (Math.random() < 0.4 ? 1 : 2) } = {}) {
    const produces = pick(RESOURCES).id;
    return {
      id: nextId++,
      type: "town",
      name: randomTownName(),
      x, y,
      produces, needs: randomNeeds(produces, needCount),
      satisfied: new Set(),
      pulse: Math.random() * Math.PI * 2,
      r: 17,
      population,
      blightedUntil: 0,
      boostedUntil: 0,
      strainSince: 0,
      strainStrikes: 0
    };
  }

  function makeOutpost(x, y) {
    return {
      id: nextId++,
      type: "outpost",
      name: "Outpost",
      x, y,
      pulse: Math.random() * Math.PI * 2,
      r: 12,
      strainSince: 0,
      strainStrikes: 0
    };
  }

  function capacityFor(n) {
    if (n.type === "outpost") return 4;
    if (n.type === "town") return n.population + 2;
    return n.population + 3; // city
  }

  function findOpenSpot() {
    for (let tries = 0; tries < 40; tries++) {
      const x = rand(W * 0.12, W * 0.88);
      const y = rand(H * 0.16, H * 0.82);
      if (settlements.every(s => dist(s, { x, y }) > mapMinDist * 0.75)) return { x, y };
    }
    return null;
  }

  // ---------- Map generation ----------
  function generateSketchMap() {
    const count = clamp(Math.round((W * H) / 52000), 7, 12);
    const pts = [];
    const minDist = Math.min(W, H) * 0.2;
    mapMinDist = minDist;
    const margin = Math.min(W, H) * 0.1;
    let attempts = 0;
    while (pts.length < count && attempts < 4000) {
      attempts++;
      const x = rand(margin, W - margin);
      const y = rand(margin + 70, H - margin - 90);
      if (pts.every(p => dist(p, { x, y }) > minDist)) pts.push({ x, y });
    }
    return pts.map(p => makeTown(p.x, p.y));
  }

  function resetMap() {
    usedNames = new Set();
    nextId = 0;
    mapMinDist = Math.min(W, H) * 0.2;

    if (mode === "zen") {
      settlements = generateSketchMap();
      score = 0;
    } else {
      const cx = rand(W * 0.35, W * 0.65);
      const cy = rand(H * 0.4, H * 0.62);
      settlements = [makeTown(cx, cy, { population: 2, needCount: 1 })];
      score = STARTING_PROSPERITY;
    }

    edges = [];
    pairCooldown.clear();
    particles = [];
    sparks = [];
    dragFrom = null;
    dragPos = null;
    activeWar = null;
    activeChoice = null;
    inspecting = null;
    paused = false;
    approval = 50;
    warRisk = 20;
    placingOutpost = false;
    dayCount = 1;
    lastDayAt = now();
    lastChoiceDay = 0;
    chronicle.length = 0;
    hideBanner();
    hideChoice();
    hideInspector();
    updateFoundButton();
    updateStatsHud();
    if (mode === "trade") {
      logChronicle(`${settlements[0].name} is founded. Your reign begins.`);
    }
  }

  // ---------- Connectivity / satisfaction ----------
  function activeEdges() { return edges.filter(e => !e.severed); }
  function byId(id) { return settlements.find(s => s.id === id); }
  function isSettled(n) { return n.type !== "outpost"; }

  function producesNow(n) {
    if (!isSettled(n)) return null;
    if (n.blightedUntil && now() < n.blightedUntil) return null;
    return n.produces;
  }

  function computeSatisfaction() {
    const nodeById = new Map(settlements.map(s => [s.id, s]));
    const adj = new Map(settlements.map(s => [s.id, []]));
    activeEdges().forEach(e => { adj.get(e.a).push(e.b); adj.get(e.b).push(e.a); });

    settlements.forEach(s => isSettled(s) && s.satisfied.clear());

    settlements.forEach(s => {
      if (!isSettled(s)) return;
      s.needs.forEach(needRes => {
        const seen = new Set([s.id]);
        const q = [s.id];
        let found = false;
        while (q.length && !found) {
          const cur = q.shift();
          for (const nb of adj.get(cur)) {
            if (seen.has(nb)) continue;
            seen.add(nb);
            const node = nodeById.get(nb);
            if (producesNow(node) === needRes) { found = true; break; }
            q.push(nb);
          }
        }
        if (found) s.satisfied.add(needRes);
      });
    });
  }

  function degree(id) {
    let d = 0;
    activeEdges().forEach(e => { if (e.a === id || e.b === id) d++; });
    return d;
  }

  function crossingPairs() {
    const nodeById = new Map(settlements.map(s => [s.id, s]));
    const act = activeEdges();
    let count = 0;
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const e1 = act[i], e2 = act[j];
        if ([e1.a, e1.b].includes(e2.a) || [e1.a, e1.b].includes(e2.b)) continue;
        if (segIntersect(nodeById.get(e1.a), nodeById.get(e1.b), nodeById.get(e2.a), nodeById.get(e2.b))) count++;
      }
    }
    return count;
  }

  // ---------- Scoring tick ----------
  let multiplier = 1;
  function scoreTick() {
    computeSatisfaction();
    const satisfiedCount = settlements.reduce((sum, s) => sum + (isSettled(s) ? s.satisfied.size : 0), 0);
    const act = activeEdges();
    const cPairs = crossingPairs();
    const crossingFree = act.length ? clamp(1 - cPairs / act.length, 0, 1) : 1;
    const overloaded = settlements.filter(s => degree(s.id) > capacityFor(s)).length;
    multiplier = clamp((0.7 + 0.6 * crossingFree) * Math.pow(0.85, overloaded), 0.3, 1.3);
    const boostBonus = settlements.reduce((sum, s) => {
      if (isSettled(s) && s.boostedUntil && now() < s.boostedUntil) return sum + s.satisfied.size * 5;
      return sum;
    }, 0);
    const gained = BASE_INCOME + Math.round(satisfiedCount * 10 * multiplier) + boostBonus;
    score += gained;
    if (score > best) {
      best = score;
      localStorage.setItem("constellate_best", String(best));
    }
    scoreEl.textContent = String(score);
    bestEl.textContent = "best reign: " + best;
  }

  function updateStatsHud() {
    approvalEl.textContent = `Approval ${Math.round(approval)}`;
    warriskEl.textContent = `War Risk ${Math.round(warRisk)}`;
  }

  // ---------- Strain / collapse ----------
  function destroySettlement(s) {
    settlements = settlements.filter(n => n.id !== s.id);
    edges = edges.filter(e => e.a !== s.id && e.b !== s.id);
    approval = clamp(approval - 10, 0, 100);
    logChronicle(`${s.name} collapsed under the weight of trade and was abandoned.`);
    showToast(`${s.name} was lost`);
    spawnSparkBurst({ x: s.x, y: s.y }, "#8a2a2a");
    if (hoverSettlement === s) hoverSettlement = null;
    if (dragFrom === s.id) { dragFrom = null; dragPos = null; }
    if (inspecting === s) hideInspector();
    updateStatsHud();
  }

  function updateStrain(t) {
    settlements.slice().forEach(s => {
      const cap = capacityFor(s);
      const deg = degree(s.id);
      if (deg > cap) {
        if (!s.strainSince) s.strainSince = t;
        else if (t - s.strainSince > STRAIN_GRACE_MS) {
          s.strainStrikes = (s.strainStrikes || 0) + 1;
          if (s.strainStrikes >= 3) {
            destroySettlement(s);
            return;
          }
          const touching = edges.filter(e => !e.severed && (e.a === s.id || e.b === s.id));
          if (touching.length) {
            const e = pick(touching);
            e.severed = true;
            spawnSparkBurst(midpointOf(e), "#8a2a2a");
            logChronicle(`${s.name} could not bear the weight of trade — a route collapsed.`);
            showToast("A route collapsed from overtrading");
          }
          s.strainSince = t;
        }
      } else {
        s.strainSince = 0;
        s.strainStrikes = 0;
      }
    });
  }

  function midpointOf(e) {
    const a = byId(e.a), b = byId(e.b);
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // ---------- War ----------
  function byType(id) { const s = byId(id); return s ? s.type : null; }

  function pickWarPair() {
    const towns = settlements.filter(isSettled);
    if (towns.length < 2) return null;
    const activeTownEdges = activeEdges().filter(e => byType(e.a) !== "outpost" && byType(e.b) !== "outpost");
    if (activeTownEdges.length && Math.random() < 0.7) {
      const e = pick(activeTownEdges);
      return { a: e.a, b: e.b, edge: e };
    }
    for (let tries = 0; tries < 20; tries++) {
      const a = pick(towns), b = pick(towns);
      if (a.id === b.id) continue;
      const cd = pairCooldown.get(keyFor(a.id, b.id));
      if (cd && now() < cd) continue;
      const edge = edges.find(e => !e.severed && ((e.a === a.id && e.b === b.id) || (e.a === b.id && e.b === a.id))) || null;
      return { a: a.id, b: b.id, edge };
    }
    return null;
  }

  function startWar() {
    const target = pickWarPair();
    if (!target) return false;
    activeWar = { a: target.a, b: target.b, edge: target.edge, warnUntil: now() + WAR_WARN_MS };
    const sa = byId(target.a), sb = byId(target.b);
    warRisk = clamp(warRisk + 15, 0, 100);
    updateStatsHud();
    if (target.edge) {
      showBanner(`⚔ War brewing — the road between ${sa.name} and ${sb.name} will be severed in 8s`);
    } else {
      showBanner(`⚔ Tensions rise — ${sa.name} and ${sb.name} refuse direct trade`);
    }
    return true;
  }

  function updateWar(t) {
    if (!activeWar) return;
    if (t < activeWar.warnUntil) return;
    const { a, b, edge } = activeWar;
    const sa = byId(a), sb = byId(b);
    if (!sa || !sb) { activeWar = null; hideBanner(); return; }
    if (edge && !edge.severed) {
      edge.severed = true;
      spawnSparkBurst(midpointOf(edge), "#8a2a2a");
      showToast("Route destroyed");
      logChronicle(`War broke out between ${sa.name} and ${sb.name}. Their road was burned.`);
    } else {
      spawnSparkBurst({ x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 }, "#8a2a2a");
      showToast("Direct trade blocked");
      logChronicle(`${sa.name} and ${sb.name} closed their border to one another's merchants.`);
    }
    pairCooldown.set(keyFor(a, b), t + BLOCKADE_MS);
    activeWar = null;
    hideBanner();
  }

  // ---------- Ambient events ----------
  function ambientHarvest() {
    const towns = settlements.filter(s => isSettled(s) && !(s.boostedUntil && now() < s.boostedUntil));
    if (!towns.length) return false;
    const t = pick(towns);
    t.boostedUntil = now() + HARVEST_MS;
    approval = clamp(approval + 2, 0, 100);
    showBanner(`✦ A bumper harvest blesses ${t.name} — its ${RES[t.produces].name.toLowerCase()} trade thrives`);
    logChronicle(`${t.name} enjoyed a bumper harvest of ${RES[t.produces].name.toLowerCase()}.`);
    return true;
  }

  function ambientGrowth() {
    const towns = settlements.filter(s => isSettled(s) && (s.population < 6 || s.needs.length < 3));
    if (!towns.length) return false;
    const t = pick(towns);
    t.population = Math.min(t.type === "city" ? 6 : 3, t.population + 1);
    if (t.needs.length < 3) {
      const options = RESOURCES.map(r => r.id).filter(r => r !== t.produces && !t.needs.includes(r));
      if (options.length) {
        const newNeed = pick(options);
        t.needs.push(newNeed);
        showBanner(`⌂ ${t.name}'s population grows — the town now hungers for ${RES[newNeed].name.toLowerCase()}`);
        logChronicle(`${t.name} grew larger, and began to need ${RES[newNeed].name.toLowerCase()}.`);
        return true;
      }
    }
    showBanner(`⌂ ${t.name}'s population grows steadily`);
    logChronicle(`${t.name} grew larger and more prosperous.`);
    return true;
  }

  function ambientBlight() {
    const towns = settlements.filter(s => isSettled(s) && !(s.blightedUntil && now() < s.blightedUntil));
    if (!towns.length) return false;
    const t = pick(towns);
    t.blightedUntil = now() + BLIGHT_MS;
    showBanner(`☠ Blight creeps through ${t.name}'s fields — its goods spoil before they can be sent`);
    logChronicle(`Blight struck ${t.name}. Its trade goods spoiled in the fields.`);
    return true;
  }

  // ---------- Choice events ----------
  function showChoice(def) {
    activeChoice = def;
    paused = true;
    choiceTitle.textContent = def.title;
    choiceText.textContent = def.text;
    choiceOptions.innerHTML = "";
    def.options.forEach(opt => {
      const btn = document.createElement("button");
      btn.className = "choiceBtn";
      btn.textContent = opt.label;
      btn.addEventListener("click", () => resolveChoice(opt));
      choiceOptions.appendChild(btn);
    });
    choiceOverlay.classList.remove("hidden");
  }
  function hideChoice() { choiceOverlay.classList.add("hidden"); }

  function resolveChoice(opt) {
    opt.effect();
    activeChoice = null;
    paused = false;
    hideChoice();
    updateStatsHud();
  }

  function triggerTribute() {
    const towns = settlements.filter(isSettled);
    if (!towns.length) return false;
    const t = pick(towns);
    showChoice({
      title: "The Tax Collector Arrives",
      text: `A royal tax collector rides into ${t.name}, demanding tribute paid in ${RES[t.produces].name.toLowerCase()}.`,
      options: [
        {
          label: "Pay the tribute — lose 40 prosperity",
          effect: () => { score = Math.max(0, score - 40); approval = clamp(approval + 5, 0, 100); logChronicle(`${t.name} paid tribute to the crown.`); }
        },
        {
          label: "Refuse the collector",
          effect: () => { t.blightedUntil = now() + 60000; approval = clamp(approval - 8, 0, 100); logChronicle(`${t.name} refused the crown and was embargoed for it.`); }
        }
      ]
    });
    return true;
  }

  function triggerAlliance() {
    showChoice({
      title: "An Offer of Alliance",
      text: "A neighboring lord offers to share coin and craft in exchange for goodwill.",
      options: [
        {
          label: "Accept — gain 40 prosperity",
          effect: () => { score += 40; approval = clamp(approval + 3, 0, 100); logChronicle("An alliance was struck with a neighboring lord."); }
        },
        {
          label: "Decline politely",
          effect: () => { logChronicle("The alliance was declined."); }
        }
      ]
    });
    return true;
  }

  function triggerRefugees() {
    showChoice({
      title: "Refugees at the Gate",
      text: "Survivors of a fallen village beg for a place to settle within your realm.",
      options: [
        {
          label: "Welcome them — found a new outpost free of charge",
          effect: () => {
            const pos = findOpenSpot();
            if (pos) { settlements.push(makeOutpost(pos.x, pos.y)); approval = clamp(approval + 3, 0, 100); logChronicle("A new outpost rose from the refugees' camp."); }
            else { score += 15; logChronicle("No open land could be found. The refugees moved on, leaving coin in thanks."); }
          }
        },
        {
          label: "Turn them away — take 15 prosperity",
          effect: () => { score += 15; approval = clamp(approval - 2, 0, 100); logChronicle("The refugees were turned away, their goods taken as toll."); }
        }
      ]
    });
    return true;
  }

  function triggerFortify() {
    showChoice({
      title: "The Realm Teeters on the Brink",
      text: "Rumors of war spread through every province. Your advisors urge you to fortify the borders.",
      options: [
        {
          label: "Fortify the borders — 80 prosperity",
          effect: () => {
            if (score >= 80) { score -= 80; warRisk = clamp(warRisk - 35, 0, 100); logChronicle("The borders were fortified against war."); }
            else { logChronicle("There was not enough coin to fortify the borders."); }
          }
        },
        {
          label: "Do nothing and hope",
          effect: () => { logChronicle("The warnings went unheeded."); }
        }
      ]
    });
    return true;
  }

  // ---------- Daily event ----------
  function fireDailyEvent() {
    if (paused || activeChoice || activeWar) return;

    if (dayCount - lastChoiceDay >= 3 && Math.random() < 0.35) {
      const choices = [triggerTribute, triggerAlliance, triggerRefugees];
      if (warRisk >= 60) choices.push(triggerFortify, triggerFortify);
      const fn = pick(choices);
      if (fn()) { lastChoiceDay = dayCount; return; }
    }

    const warWeight = warRisk >= 60 ? 4 : 2;
    const pool = [];
    for (let i = 0; i < warWeight; i++) pool.push(startWar);
    pool.push(ambientHarvest, ambientGrowth, ambientBlight);
    for (let i = 0; i < 6; i++) {
      if (pick(pool)()) return;
    }
  }

  // ---------- Banner / toast ----------
  function showBanner(text) { bannerEl.textContent = text; bannerEl.classList.remove("hidden"); }
  function hideBanner() { bannerEl.classList.add("hidden"); }

  let toastTimeout = null;
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.classList.add("hidden"), 1600);
  }

  // ---------- Chronicle overlay ----------
  function renderChronicle() {
    chronicleList.innerHTML = "";
    if (!chronicle.length) {
      chronicleList.innerHTML = `<div class="chronicle-entry">Nothing has yet been written.</div>`;
      return;
    }
    chronicle.forEach(entry => {
      const div = document.createElement("div");
      div.className = "chronicle-entry";
      div.innerHTML = `<span class="day">Day ${entry.day}</span>${entry.text}`;
      chronicleList.appendChild(div);
    });
  }
  chronicleBtn.addEventListener("click", () => { renderChronicle(); chronicleOverlay.classList.remove("hidden"); });
  chronicleCloseBtn.addEventListener("click", () => chronicleOverlay.classList.add("hidden"));

  // ---------- Inspector ----------
  function showInspector(node) {
    inspecting = node;
    inspectorName.textContent = node.type === "outpost" ? "Outpost" : node.name;
    if (node.type === "outpost") {
      inspectorTier.textContent = "A relay post. Carries trade through, produces nothing of its own.";
      inspectorTrade.textContent = `Routes: ${degree(node.id)} / ${capacityFor(node)}`;
    } else {
      const tierLabel = node.type === "city" ? "City" : "Town";
      inspectorTier.textContent = `${tierLabel} · population ${node.population}`;
      const exports = RES[node.produces].name;
      const imports = node.needs.map(n => `${RES[n].name}${node.satisfied.has(n) ? " ✓" : ""}`).join(", ");
      inspectorTrade.textContent = `Exports: ${exports}. Imports: ${imports || "none"}. Routes: ${degree(node.id)} / ${capacityFor(node)}.`;
    }

    inspectorUpgrade.innerHTML = "";
    if (mode === "trade") {
      if (node.type === "outpost") {
        const btn = document.createElement("button");
        btn.className = "choiceBtn";
        btn.textContent = `Charter as a Town — ${UPGRADE_TOWN_COST} prosperity`;
        btn.addEventListener("click", () => upgradeSettlement(node));
        inspectorUpgrade.appendChild(btn);
      } else if (node.type === "town") {
        const btn = document.createElement("button");
        btn.className = "choiceBtn";
        btn.textContent = `Grow into a City — ${UPGRADE_CITY_COST} prosperity`;
        btn.addEventListener("click", () => upgradeSettlement(node));
        inspectorUpgrade.appendChild(btn);
      } else {
        const p = document.createElement("p");
        p.className = "tip";
        p.textContent = "This city has reached its full stature.";
        inspectorUpgrade.appendChild(p);
      }
    }
    inspectorOverlay.classList.remove("hidden");
  }
  function hideInspector() { inspecting = null; inspectorOverlay.classList.add("hidden"); }
  inspectorCloseBtn.addEventListener("click", hideInspector);

  function upgradeSettlement(node) {
    if (node.type === "outpost") {
      if (score < UPGRADE_TOWN_COST) { showToast("Not enough prosperity"); return; }
      score -= UPGRADE_TOWN_COST;
      const produces = pick(RESOURCES).id;
      Object.assign(node, {
        type: "town",
        name: randomTownName(),
        produces,
        needs: randomNeeds(produces, 1),
        satisfied: new Set(),
        population: 1,
        r: 17
      });
      approval = clamp(approval + 2, 0, 100);
      logChronicle(`${node.name} was chartered as a town.`);
    } else if (node.type === "town") {
      if (score < UPGRADE_CITY_COST) { showToast("Not enough prosperity"); return; }
      score -= UPGRADE_CITY_COST;
      node.type = "city";
      node.population = Math.min(6, node.population + 2);
      node.r = 21;
      if (node.needs.length < 3) {
        const options = RESOURCES.map(r => r.id).filter(r => r !== node.produces && !node.needs.includes(r));
        if (options.length) node.needs.push(pick(options));
      }
      approval = clamp(approval + 4, 0, 100);
      logChronicle(`${node.name} grew into a great city.`);
    }
    updateStatsHud();
    hideInspector();
  }

  // ---------- Found button ----------
  function updateFoundButton() {
    outpostBtn.textContent = mode === "zen" ? "Found (free)" : `Found (${FOUND_COST})`;
    outpostBtn.classList.toggle("armed", placingOutpost);
  }

  function tryFoundOutpost(pos) {
    const minGap = mapMinDist * 0.5;
    const tooClose = settlements.some(s => dist(s, pos) < minGap) ||
      pos.x < 30 || pos.x > W - 30 || pos.y < 60 || pos.y > H - 70;
    if (tooClose) { showToast("Too close to build here"); return; }
    if (mode !== "zen") {
      if (score < FOUND_COST) { showToast("Not enough prosperity"); return; }
      score -= FOUND_COST;
    }
    settlements.push(makeOutpost(pos.x, pos.y));
    placingOutpost = false;
    updateFoundButton();
    showToast("Outpost founded");
  }

  outpostBtn.addEventListener("click", () => {
    placingOutpost = !placingOutpost;
    updateFoundButton();
  });

  // ---------- Particles ----------
  function spawnSparkBurst(pos, color) {
    for (let i = 0; i < 14; i++) {
      const ang = rand(0, Math.PI * 2);
      const speed = rand(0.5, 2.4);
      sparks.push({ x: pos.x, y: pos.y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, life: 1, color });
    }
  }

  let flowAccum = 0;
  const FLOW_SPAWN_MS = 1500;
  function updateParticles(dt) {
    flowAccum += dt;
    if (flowAccum > FLOW_SPAWN_MS) {
      flowAccum = 0;
      activeEdges().forEach(e => {
        const a = byId(e.a), b = byId(e.b);
        if (!a || !b) return;
        const colorA = producesNow(a);
        const colorB = producesNow(b);
        if (colorA) particles.push({ edge: e, from: e.a, to: e.b, t: 0, color: colorA, speed: rand(0.16, 0.24) });
        if (colorB) particles.push({ edge: e, from: e.b, to: e.a, t: 0, color: colorB, speed: rand(0.16, 0.24) });
      });
    }
    particles = particles.filter(p => !p.edge.severed && p.t < 1);
    particles.forEach(p => { p.t += p.speed * (dt / 1000); });

    sparks.forEach(s => { s.x += s.vx; s.y += s.vy; s.vx *= 0.94; s.vy *= 0.94; s.life -= 0.03; });
    sparks = sparks.filter(s => s.life > 0);
  }

  // ---------- Input ----------
  function nearestSettlement(x, y, maxR) {
    let best = null, bd = Infinity;
    settlements.forEach(s => { const d = dist(s, { x, y }); if (d < bd) { bd = d; best = s; } });
    return bd <= maxR ? best : null;
  }

  function nearestEdge(x, y, maxR) {
    let best = null, bd = Infinity;
    activeEdges().forEach(e => {
      const d = distToSeg({ x, y }, byId(e.a), byId(e.b));
      if (d < bd) { bd = d; best = e; }
    });
    return bd <= maxR ? best : null;
  }

  function edgeExists(a, b) {
    return edges.some(e => !e.severed && ((e.a === a && e.b === b) || (e.a === b && e.b === a)));
  }

  function tryConnect(aId, bId) {
    if (aId === bId) return;
    if (edgeExists(aId, bId)) return;
    if (activeWar && ((activeWar.a === aId && activeWar.b === bId) || (activeWar.a === bId && activeWar.b === aId))) {
      showToast("Can't route through open conflict");
      return;
    }
    const cd = pairCooldown.get(keyFor(aId, bId));
    if (cd && now() < cd) { showToast("Too dangerous to rebuild yet"); return; }
    edges.push({ a: aId, b: bId, severed: false, born: now() });
  }

  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!started || paused) return;
    const pos = getPos(e);

    if (placingOutpost) { tryFoundOutpost(pos); return; }

    if (mode === "zen") {
      const edge = nearestEdge(pos.x, pos.y, 14);
      if (edge && !nearestSettlement(pos.x, pos.y, 22)) {
        edges = edges.filter(ed => ed !== edge);
        return;
      }
    }
    const s = nearestSettlement(pos.x, pos.y, 26);
    if (s) { dragFrom = s.id; dragPos = { x: s.x, y: s.y }; dragStartPos = pos; canvas.setPointerCapture(e.pointerId); }
  });

  canvas.addEventListener("pointermove", (e) => {
    const pos = getPos(e);
    if (dragFrom !== null) { dragPos = pos; }
    hoverSettlement = nearestSettlement(pos.x, pos.y, 26);
  });

  function endDrag(e) {
    if (dragFrom === null) return;
    const pos = getPos(e);
    const target = nearestSettlement(pos.x, pos.y, 30);
    const moved = dragStartPos ? dist(dragStartPos, pos) : 999;
    if (target && target.id !== dragFrom) {
      tryConnect(dragFrom, target.id);
    } else if (target && target.id === dragFrom && moved < 10) {
      showInspector(target);
    }
    dragFrom = null;
    dragPos = null;
    dragStartPos = null;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", () => { dragFrom = null; dragPos = null; dragStartPos = null; });

  // ---------- Mode / map controls ----------
  function setMode(m) {
    mode = m;
    modeBtn.textContent = m === "trade" ? "Kingdom" : "Sketch";
    resetMap();
  }
  modeBtn.addEventListener("click", () => setMode(mode === "trade" ? "zen" : "trade"));
  newMapBtn.addEventListener("click", resetMap);

  startBtn.addEventListener("click", () => { mode = "trade"; modeBtn.textContent = "Kingdom"; resetMap(); introEl.classList.add("hidden"); started = true; });
  startZenBtn.addEventListener("click", () => { mode = "zen"; modeBtn.textContent = "Sketch"; resetMap(); introEl.classList.add("hidden"); started = true; });

  // ---------- Icon drawing ----------
  function drawResourceIcon(id, x, y, s, color) {
    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineWidth = Math.max(1.3, s * 0.16);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    switch (id) {
      case "grain":
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(0, s * 0.5);
          ctx.lineTo(i * s * 0.4, -s * 0.5);
          ctx.stroke();
        }
        break;
      case "timber":
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.55);
        ctx.lineTo(s * 0.45, s * 0.15);
        ctx.lineTo(-s * 0.45, s * 0.15);
        ctx.closePath();
        ctx.fill();
        ctx.fillRect(-s * 0.08, s * 0.12, s * 0.16, s * 0.4);
        break;
      case "ore":
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.55);
        ctx.lineTo(s * 0.45, 0);
        ctx.lineTo(0, s * 0.55);
        ctx.lineTo(-s * 0.45, 0);
        ctx.closePath();
        ctx.fill();
        break;
      case "cloth":
        ctx.beginPath();
        ctx.moveTo(-s * 0.5, -s * 0.4);
        ctx.lineTo(0, 0);
        ctx.lineTo(-s * 0.5, s * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(s * 0.5, -s * 0.4);
        ctx.lineTo(0, 0);
        ctx.lineTo(s * 0.5, s * 0.4);
        ctx.closePath();
        ctx.fill();
        break;
      case "spice":
        ctx.beginPath();
        ctx.moveTo(-s * 0.32, -s * 0.15);
        ctx.quadraticCurveTo(-s * 0.45, s * 0.55, 0, s * 0.55);
        ctx.quadraticCurveTo(s * 0.45, s * 0.55, s * 0.32, -s * 0.15);
        ctx.quadraticCurveTo(0, -s * 0.05, -s * 0.32, -s * 0.15);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-s * 0.12, -s * 0.15);
        ctx.lineTo(0, -s * 0.55);
        ctx.lineTo(s * 0.12, -s * 0.15);
        ctx.stroke();
        break;
      case "tools":
        ctx.save(); ctx.rotate(Math.PI / 4);
        ctx.fillRect(-s * 0.08, -s * 0.5, s * 0.16, s);
        ctx.fillRect(-s * 0.28, -s * 0.5, s * 0.56, s * 0.2);
        ctx.restore();
        ctx.save(); ctx.rotate(-Math.PI / 4);
        ctx.fillRect(-s * 0.08, -s * 0.5, s * 0.16, s);
        ctx.fillRect(-s * 0.28, -s * 0.5, s * 0.56, s * 0.2);
        ctx.restore();
        break;
    }
    ctx.restore();
  }

  // ---------- Rendering ----------
  function drawBackground() {
    if (texture) ctx.drawImage(texture, 0, 0, W, H);
  }

  function drawEdge(e) {
    const a = byId(e.a), b = byId(e.b);
    if (!a || !b) return;
    if (e.severed) {
      ctx.save();
      ctx.strokeStyle = "rgba(107, 86, 54, 0.4)";
      ctx.setLineDash([5, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.strokeStyle = "rgba(59, 42, 26, 0.55)";
    ctx.lineWidth = 3.4;
    ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    ctx.strokeStyle = "rgba(236, 224, 188, 0.65)";
    ctx.setLineDash([2, 5]);
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }

  function drawWarWarning(t) {
    if (!activeWar) return;
    const a = byId(activeWar.a), b = byId(activeWar.b);
    if (!a || !b) return;
    const pulse = 0.5 + 0.5 * Math.sin(t / 90);
    ctx.save();
    ctx.strokeStyle = `rgba(138, 42, 42, ${0.55 + 0.35 * pulse})`;
    ctx.lineWidth = 3.5;
    ctx.setLineDash(activeWar.edge ? [] : [4, 8]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach(p => {
      const a = byId(p.from), b = byId(p.to);
      if (!a || !b) return;
      const x = a.x + (b.x - a.x) * p.t;
      const y = a.y + (b.y - a.y) * p.t;
      ctx.save();
      ctx.fillStyle = RES[p.color].color;
      ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
    sparks.forEach(s => {
      ctx.save();
      ctx.globalAlpha = clamp(s.life, 0, 1);
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(s.x, s.y, 2, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    });
  }

  function drawRingDecorations(s, t) {
    const cap = capacityFor(s);
    const deg = degree(s.id);
    const strained = mode === "trade" && deg > cap;
    if (strained) {
      const p = 0.5 + 0.5 * Math.sin(t / 150);
      ctx.save();
      ctx.strokeStyle = `rgba(138, 42, 42, ${0.45 + 0.35 * p})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 13, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    if (hoverSettlement === s || dragFrom === s.id) {
      ctx.save();
      ctx.strokeStyle = "rgba(59, 42, 26, 0.6)";
      ctx.lineWidth = 1.4;
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 17, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.font = "600 13px Charter, Georgia, serif";
      ctx.fillStyle = "#3b2a1a";
      ctx.textAlign = "center";
      const label = s.type === "outpost" ? "Outpost" : `${s.name} (${deg}/${cap})`;
      ctx.fillText(label, s.x, s.y - s.r - 22);
      ctx.restore();
    }
  }

  function drawTown(s, t) {
    const blighted = s.blightedUntil && now() < s.blightedUntil;
    const boosted = s.boostedUntil && now() < s.boostedUntil;
    const color = blighted ? "#6b6b34" : RES[s.produces].color;
    s.pulse += 0.012;

    if (boosted) {
      const g = 8 + Math.sin(s.pulse) * 4;
      ctx.save();
      ctx.shadowColor = "#93691a";
      ctx.shadowBlur = g;
      ctx.beginPath();
      ctx.fillStyle = "rgba(147, 105, 26, 0.18)";
      ctx.arc(s.x, s.y, s.r + 9, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = blighted ? "#c9c1a0" : "#f3e8c8";
    ctx.strokeStyle = "#3b2a1a";
    ctx.lineWidth = 1.6;
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    if (s.type === "city") {
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r + 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();

    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r - 2, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();

    drawResourceIcon(s.produces, s.x, s.y, s.r * 0.85, blighted ? "#8a8a52" : "#3b2a1a");

    if (blighted) {
      ctx.save();
      ctx.strokeStyle = "rgba(107, 107, 52, 0.9)";
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(s.x - s.r * 0.7, s.y - s.r * 0.7);
      ctx.lineTo(s.x + s.r * 0.7, s.y + s.r * 0.7);
      ctx.stroke();
      ctx.restore();
    }

    const pipY = s.y + s.r + 9;
    const total = s.population;
    for (let i = 0; i < total; i++) {
      const px = s.x + (i - (total - 1) / 2) * 7;
      ctx.save();
      ctx.fillStyle = "#3b2a1a";
      ctx.beginPath(); ctx.arc(px, pipY, 1.8, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }

    if (mode === "trade") {
      const n = s.needs.length;
      s.needs.forEach((needRes, i) => {
        const satisfied = s.satisfied.has(needRes);
        const startA = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const endA = startA + (Math.PI * 2 / n) - 0.22;
        ctx.save();
        ctx.strokeStyle = satisfied ? "#93691a" : "rgba(59,42,26,0.3)";
        ctx.lineWidth = 3;
        if (!satisfied) ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + 6, startA, endA);
        ctx.stroke();
        ctx.restore();
      });
    }

    drawRingDecorations(s, t);
  }

  function drawOutpost(s, t) {
    s.pulse += 0.012;
    const w = s.r * 1.5, h = s.r * 1.7;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = "#e4d6ab";
    ctx.strokeStyle = "#3b2a1a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect(-w / 2, -h / 2 + 3, w, h - 3);
    ctx.fill(); ctx.stroke();
    const notch = w / 4;
    for (let i = 0; i < 3; i++) {
      ctx.fillRect(-w / 2 + i * notch + notch * 0.15, -h / 2 - 4, notch * 0.7, 7);
      ctx.strokeRect(-w / 2 + i * notch + notch * 0.15, -h / 2 - 4, notch * 0.7, 7);
    }
    ctx.strokeStyle = "#3b2a1a";
    ctx.beginPath(); ctx.moveTo(0, -h / 2 - 4); ctx.lineTo(0, -h / 2 - 14); ctx.stroke();
    ctx.fillStyle = "#8a2a2a";
    ctx.beginPath(); ctx.moveTo(0, -h / 2 - 14); ctx.lineTo(9, -h / 2 - 10); ctx.lineTo(0, -h / 2 - 6); ctx.fill();
    ctx.restore();

    drawRingDecorations(s, t);
  }

  function drawDrag() {
    if (dragFrom === null || !dragPos) return;
    const a = byId(dragFrom);
    if (!a) return;
    ctx.save();
    ctx.strokeStyle = "rgba(59, 42, 26, 0.55)";
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(dragPos.x, dragPos.y); ctx.stroke();
    ctx.restore();
  }

  function drawMultiplier() {
    if (mode !== "trade") return;
    ctx.save();
    ctx.font = "600 12px Charter, Georgia, serif";
    ctx.fillStyle = "rgba(59,42,26,0.6)";
    ctx.textAlign = "left";
    ctx.fillText(`×${multiplier.toFixed(2)} trade flow — Day ${dayCount}`, 20, H - 14 - 46);
    ctx.restore();
  }

  function frame(t) {
    const dt = paused ? 0 : t - lastTick;
    lastTick = t;

    ctx.clearRect(0, 0, W, H);
    drawBackground();

    if (started) {
      if (!paused) {
        updateParticles(dt);
        if (mode === "trade" && now() - lastDayAt > DAY_LENGTH_MS) {
          dayCount++;
          lastDayAt = now();
          warRisk = clamp(warRisk - 3, 0, 100);
          approval += approval < 50 ? 1 : (approval > 50 ? -1 : 0);
          approval = clamp(approval, 0, 100);
          updateStatsHud();
          fireDailyEvent();
        }
        if (mode === "trade") updateWar(now());
      }
      edges.forEach(e => drawEdge(e));
      drawWarWarning(t);
      drawParticles();
      settlements.forEach(s => (s.type === "outpost" ? drawOutpost(s, t) : drawTown(s, t)));
      drawDrag();
      drawMultiplier();
    }

    requestAnimationFrame(frame);
  }

  setInterval(() => {
    if (started && mode === "trade" && !paused) {
      scoreTick();
      updateStrain(now());
    }
  }, 1000);

  resetMap();
  requestAnimationFrame(frame);
})();
