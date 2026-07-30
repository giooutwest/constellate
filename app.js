(() => {
  "use strict";

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    });
  }

  // ---------- Setup ----------
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const bestEl = document.getElementById("best");
  const modeBtn = document.getElementById("modeBtn");
  const newMapBtn = document.getElementById("newMapBtn");
  const bannerEl = document.getElementById("banner");
  const legendEl = document.getElementById("legend");
  const toastEl = document.getElementById("toast");
  const introEl = document.getElementById("intro");
  const startBtn = document.getElementById("startBtn");
  const startZenBtn = document.getElementById("startZenBtn");

  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2.5);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = Math.floor(W * DPR);
    canvas.height = Math.floor(H * DPR);
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener("resize", resize);
  resize();

  // ---------- Resources ----------
  const RESOURCES = [
    { id: "grain", name: "Grain", color: "#ffd35e" },
    { id: "timber", name: "Timber", color: "#8dff8d" },
    { id: "ore", name: "Ore", color: "#8fb4ff" },
    { id: "cloth", name: "Cloth", color: "#ff8fd8" },
    { id: "spice", name: "Spice", color: "#c48fff" },
    { id: "tools", name: "Tools", color: "#5ee6ff" }
  ];
  const RES = Object.fromEntries(RESOURCES.map(r => [r.id, r]));

  function renderLegend() {
    legendEl.innerHTML = "";
    RESOURCES.forEach(r => {
      const chip = document.createElement("div");
      chip.className = "legend-chip";
      chip.innerHTML = `<span class="legend-dot" style="background:${r.color};box-shadow:0 0 6px ${r.color}"></span>${r.name}`;
      legendEl.appendChild(chip);
    });
  }
  renderLegend();

  // ---------- Utility ----------
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const pick = (arr) => arr[randInt(0, arr.length - 1)];
  const now = () => performance.now();

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

  // ---------- Game state ----------
  let mode = "trade"; // 'trade' | 'zen'
  let settlements = [];
  let edges = []; // {a,b, severed, warn, warnUntil, severedAt, born}
  let pairCooldown = new Map(); // "a-b" -> timestamp until which reconnecting is blocked
  let particles = [];
  let sparks = [];
  let score = 0;
  let best = Number(localStorage.getItem("constellate_best") || 0);
  let dragFrom = null;
  let dragPos = null;
  let hoverSettlement = null;
  let lastTick = now();
  let nextEventAt = now() + rand(18000, 30000);
  let started = false;

  bestEl.textContent = "best " + best;

  function keyFor(i, j) { return i < j ? `${i}-${j}` : `${j}-${i}`; }

  // ---------- Map generation ----------
  function generateSettlements() {
    const count = clamp(Math.round((W * H) / 42000), 9, 15);
    const pts = [];
    const minDist = Math.min(W, H) * 0.16;
    const margin = Math.min(W, H) * 0.1;
    let attempts = 0;
    while (pts.length < count && attempts < 4000) {
      attempts++;
      const x = rand(margin, W - margin);
      const y = rand(margin + 70, H - margin - 90);
      if (pts.every(p => dist(p, { x, y }) > minDist)) pts.push({ x, y });
    }
    // assign produce round-robin then shuffle for even coverage
    const produceList = [];
    for (let i = 0; i < pts.length; i++) produceList.push(RESOURCES[i % RESOURCES.length].id);
    for (let i = produceList.length - 1; i > 0; i--) {
      const j = randInt(0, i);
      [produceList[i], produceList[j]] = [produceList[j], produceList[i]];
    }
    return pts.map((p, i) => {
      const produces = produceList[i];
      const needCount = Math.random() < 0.55 ? 1 : 2;
      const needs = [];
      while (needs.length < needCount) {
        const r = pick(RESOURCES).id;
        if (r !== produces && !needs.includes(r)) needs.push(r);
      }
      return {
        id: i,
        x: p.x, y: p.y,
        produces, needs,
        capacity: mode === "zen" ? 999 : randInt(2, 3),
        satisfied: new Set(),
        pulse: Math.random() * Math.PI * 2,
        r: 16
      };
    });
  }

  function resetMap() {
    settlements = generateSettlements();
    edges = [];
    pairCooldown.clear();
    particles = [];
    sparks = [];
    score = 0;
    dragFrom = null;
    dragPos = null;
    nextEventAt = now() + rand(18000, 30000);
    hideBanner();
  }

  // ---------- Connectivity / satisfaction ----------
  function activeEdges() { return edges.filter(e => !e.severed); }

  function computeSatisfaction() {
    const adj = settlements.map(() => []);
    activeEdges().forEach(e => { adj[e.a].push(e.b); adj[e.b].push(e.a); });

    settlements.forEach(s => s.satisfied.clear());

    settlements.forEach(s => {
      s.needs.forEach(needRes => {
        // BFS from s over active edges, looking for a settlement producing needRes
        const seen = new Set([s.id]);
        const q = [s.id];
        let found = false;
        while (q.length && !found) {
          const cur = q.shift();
          for (const nb of adj[cur]) {
            if (seen.has(nb)) continue;
            seen.add(nb);
            if (settlements[nb].produces === needRes) { found = true; break; }
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
    const act = activeEdges();
    let count = 0;
    for (let i = 0; i < act.length; i++) {
      for (let j = i + 1; j < act.length; j++) {
        const e1 = act[i], e2 = act[j];
        if ([e1.a, e1.b].includes(e2.a) || [e1.a, e1.b].includes(e2.b)) continue;
        if (segIntersect(settlements[e1.a], settlements[e1.b], settlements[e2.a], settlements[e2.b])) count++;
      }
    }
    return count;
  }

  // ---------- Scoring tick ----------
  let multiplier = 1;
  function scoreTick() {
    computeSatisfaction();
    const satisfiedCount = settlements.reduce((sum, s) => sum + s.satisfied.size, 0);
    const act = activeEdges();
    const cPairs = crossingPairs();
    const crossingFree = act.length ? clamp(1 - cPairs / act.length, 0, 1) : 1;
    const overloaded = settlements.filter(s => degree(s.id) > s.capacity).length;
    multiplier = clamp((0.7 + 0.6 * crossingFree) * Math.pow(0.85, overloaded), 0.3, 1.3);
    const gained = Math.round(satisfiedCount * 10 * multiplier);
    score += gained;
    if (score > best) {
      best = score;
      localStorage.setItem("constellate_best", String(best));
    }
    scoreEl.textContent = String(score);
    bestEl.textContent = "best " + best;
  }

  // ---------- Events (war) ----------
  function maybeTriggerEvent(t) {
    if (mode !== "trade") return;
    if (t < nextEventAt) return;
    const candidates = activeEdges().filter(e => !e.warn);
    if (!candidates.length) { nextEventAt = t + rand(8000, 14000); return; }
    const e = pick(candidates);
    e.warn = true;
    e.warnUntil = t + 5000;
    const sa = settlements[e.a], sb = settlements[e.b];
    showBanner(`⚔ War brewing — route ${sa.produces.toUpperCase()}↔${sb.produces.toUpperCase()} severed in 5s`);
    nextEventAt = t + rand(22000, 36000);
  }

  function updateEvents(t) {
    edges.forEach(e => {
      if (e.warn && !e.severed && t >= e.warnUntil) {
        e.severed = true;
        e.severedAt = t;
        e.warn = false;
        pairCooldown.set(keyFor(e.a, e.b), t + 20000);
        hideBanner();
        spawnSparkBurst(midpoint(e), "#ff5e5e");
        showToast("Route destroyed");
      }
    });
  }

  function midpoint(e) {
    const a = settlements[e.a], b = settlements[e.b];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  // ---------- Banner / toast ----------
  let bannerTimeout = null;
  function showBanner(text) {
    bannerEl.textContent = text;
    bannerEl.classList.remove("hidden");
  }
  function hideBanner() { bannerEl.classList.add("hidden"); }

  let toastTimeout = null;
  function showToast(text) {
    toastEl.textContent = text;
    toastEl.classList.remove("hidden");
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toastEl.classList.add("hidden"), 1400);
  }

  // ---------- Particles ----------
  function spawnSparkBurst(pos, color) {
    for (let i = 0; i < 14; i++) {
      const ang = rand(0, Math.PI * 2);
      const speed = rand(0.5, 2.4);
      sparks.push({
        x: pos.x, y: pos.y,
        vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
        life: 1, color
      });
    }
  }

  let flowAccum = 0;
  function updateParticles(dt) {
    flowAccum += dt;
    if (flowAccum > 650) {
      flowAccum = 0;
      activeEdges().forEach(e => {
        const a = settlements[e.a], b = settlements[e.b];
        particles.push({ edge: e, from: e.a, to: e.b, t: 0, color: a.produces, speed: rand(0.35, 0.55) });
        particles.push({ edge: e, from: e.b, to: e.a, t: 0, color: b.produces, speed: rand(0.35, 0.55) });
      });
    }
    particles = particles.filter(p => !p.edge.severed && p.t < 1);
    particles.forEach(p => { p.t += p.speed * (dt / 1000); });

    sparks.forEach(s => {
      s.x += s.vx; s.y += s.vy; s.vx *= 0.94; s.vy *= 0.94; s.life -= 0.03;
    });
    sparks = sparks.filter(s => s.life > 0);
  }

  // ---------- Input ----------
  function nearestSettlement(x, y, maxR) {
    let best = null, bd = Infinity;
    settlements.forEach(s => {
      const d = dist(s, { x, y });
      if (d < bd) { bd = d; best = s; }
    });
    return bd <= maxR ? best : null;
  }

  function nearestEdge(x, y, maxR) {
    let best = null, bd = Infinity;
    activeEdges().forEach(e => {
      const d = distToSeg({ x, y }, settlements[e.a], settlements[e.b]);
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
    const cd = pairCooldown.get(keyFor(aId, bId));
    if (cd && now() < cd) { showToast("Too dangerous to rebuild yet"); return; }
    edges.push({ a: aId, b: bId, severed: false, warn: false, warnUntil: 0, born: now() });
  }

  function getPos(evt) {
    const rect = canvas.getBoundingClientRect();
    return { x: evt.clientX - rect.left, y: evt.clientY - rect.top };
  }

  canvas.addEventListener("pointerdown", (e) => {
    if (!started) return;
    const pos = getPos(e);
    if (mode === "zen") {
      const edge = nearestEdge(pos.x, pos.y, 14);
      if (edge && !nearestSettlement(pos.x, pos.y, 22)) {
        edge.severed = true; // reuse for removal in zen (no cooldown consequence)
        edges = edges.filter(ed => ed !== edge);
        return;
      }
    }
    const s = nearestSettlement(pos.x, pos.y, 26);
    if (s) { dragFrom = s.id; dragPos = { x: s.x, y: s.y }; canvas.setPointerCapture(e.pointerId); }
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
    if (target && target.id !== dragFrom) tryConnect(dragFrom, target.id);
    dragFrom = null;
    dragPos = null;
  }
  canvas.addEventListener("pointerup", endDrag);
  canvas.addEventListener("pointercancel", () => { dragFrom = null; dragPos = null; });

  // ---------- Mode / map controls ----------
  function setMode(m) {
    mode = m;
    modeBtn.textContent = m === "trade" ? "Trade" : "Zen";
    resetMap();
  }
  modeBtn.addEventListener("click", () => setMode(mode === "trade" ? "zen" : "trade"));
  newMapBtn.addEventListener("click", resetMap);

  startBtn.addEventListener("click", () => { mode = "trade"; modeBtn.textContent = "Trade"; resetMap(); introEl.classList.add("hidden"); started = true; });
  startZenBtn.addEventListener("click", () => { mode = "zen"; modeBtn.textContent = "Zen"; resetMap(); introEl.classList.add("hidden"); started = true; });

  // ---------- Rendering ----------
  function drawBackground(t) {
    const g = ctx.createRadialGradient(W * 0.5, H * 0.35, 0, W * 0.5, H * 0.35, Math.max(W, H) * 0.8);
    g.addColorStop(0, "#12142a");
    g.addColorStop(1, "#05060f");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawEdge(e, t) {
    const a = settlements[e.a], b = settlements[e.b];
    if (e.severed) {
      ctx.save();
      ctx.strokeStyle = "rgba(150,150,170,0.35)";
      ctx.setLineDash([6, 7]);
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      ctx.restore();
      return;
    }
    const c1 = RES[a.produces].color, c2 = RES[b.produces].color;
    const grad = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    grad.addColorStop(0, c1);
    grad.addColorStop(1, c2);
    ctx.save();
    if (e.warn) {
      const pulse = 0.5 + 0.5 * Math.sin(t / 90);
      ctx.strokeStyle = `rgba(255,${Math.round(70 + 40 * pulse)},${Math.round(70 + 40 * pulse)},0.9)`;
      ctx.shadowColor = "#ff5e5e";
      ctx.shadowBlur = 18;
      ctx.lineWidth = 3;
    } else {
      ctx.strokeStyle = grad;
      ctx.shadowColor = c1;
      ctx.shadowBlur = 8;
      ctx.lineWidth = 2.2;
    }
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.restore();
  }

  function drawParticles() {
    particles.forEach(p => {
      const a = settlements[p.from], b = settlements[p.to];
      const x = a.x + (b.x - a.x) * p.t;
      const y = a.y + (b.y - a.y) * p.t;
      ctx.save();
      ctx.fillStyle = RES[p.color].color;
      ctx.shadowColor = RES[p.color].color;
      ctx.shadowBlur = 10;
      ctx.beginPath(); ctx.arc(x, y, 2.6, 0, Math.PI * 2); ctx.fill();
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

  function drawSettlement(s, t) {
    const overloaded = mode === "trade" && degree(s.id) > s.capacity;
    const color = RES[s.produces].color;
    s.pulse += 0.02;
    const glow = 10 + Math.sin(s.pulse) * 3;

    ctx.save();
    ctx.beginPath();
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = glow;
    ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.fillStyle = "#05060f";
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 0.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    if (mode === "trade") {
      const n = s.needs.length;
      s.needs.forEach((needRes, i) => {
        const satisfied = s.satisfied.has(needRes);
        const startA = -Math.PI / 2 + (i / n) * Math.PI * 2;
        const endA = startA + (Math.PI * 2 / n) - 0.18;
        ctx.save();
        ctx.strokeStyle = satisfied ? RES[needRes].color : "rgba(255,255,255,0.25)";
        ctx.lineWidth = 3;
        if (!satisfied) ctx.setLineDash([3, 4]);
        ctx.shadowColor = satisfied ? RES[needRes].color : "transparent";
        ctx.shadowBlur = satisfied ? 8 : 0;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + 6, startA, endA);
        ctx.stroke();
        ctx.restore();
      });
    }

    if (overloaded) {
      const p = 0.5 + 0.5 * Math.sin(t / 120);
      ctx.save();
      ctx.strokeStyle = `rgba(255,90,90,${0.4 + 0.4 * p})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 12, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }

    if (hoverSettlement === s || dragFrom === s.id) {
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.5)";
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r + 16, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  function drawDrag() {
    if (dragFrom === null || !dragPos) return;
    const a = settlements[dragFrom];
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.setLineDash([5, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(dragPos.x, dragPos.y); ctx.stroke();
    ctx.restore();
  }

  function drawMultiplier() {
    if (mode !== "trade") return;
    ctx.save();
    ctx.font = "600 12px -apple-system, sans-serif";
    ctx.fillStyle = "rgba(234,241,255,0.65)";
    ctx.textAlign = "left";
    ctx.fillText(`×${multiplier.toFixed(2)} flow`, 16, H - 14 - 46);
    ctx.restore();
  }

  function frame(t) {
    const dt = t - lastTick;
    lastTick = t;

    ctx.clearRect(0, 0, W, H);
    drawBackground(t);

    if (started) {
      updateParticles(dt);
      if (mode === "trade") {
        maybeTriggerEvent(now());
        updateEvents(now());
      }
      edges.forEach(e => drawEdge(e, t));
      drawParticles();
      settlements.forEach(s => drawSettlement(s, t));
      drawDrag();
      drawMultiplier();
    }

    requestAnimationFrame(frame);
  }

  // score tick loop (independent cadence)
  setInterval(() => { if (started && mode === "trade") scoreTick(); }, 1000);

  resetMap();
  requestAnimationFrame(frame);
})();
