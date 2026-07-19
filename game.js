(() => {
  "use strict";

  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");
  const scoreEl = document.getElementById("score");
  const livesEl = document.getElementById("lives");
  const coinsEl = document.getElementById("coins");
  const overlay = document.getElementById("overlay");
  const overlayTitle = document.getElementById("overlay-title");
  const overlayMsg = document.getElementById("overlay-msg");
  const startBtn = document.getElementById("start-btn");
  const muteBtn = document.getElementById("mute-btn");
  const modeBadge = document.getElementById("mode-badge");
  const modePicker = document.getElementById("mode-picker");
  const agentChip = document.getElementById("agent-chip");
  const controlsList = document.getElementById("controls-list");

  const MODES = {
    classic: {
      id: "classic",
      label: "CLASSIC",
      title: "Classic",
      blurb: "You drive blind. Code bugs crawl, while landmines and edge cases stay hidden.",
      lives: 2,
      reveal: "none",
      agent: false,
    },
    context: {
      id: "context",
      label: "CONTEXT GRAPH",
      title: "Context Graph",
      blurb: "A live threat graph identifies bugs, hidden edge cases and runtime hazards by distance.",
      lives: 3,
      reveal: "partial",
      agent: false,
    },
    agent: {
      id: "agent",
      label: "AUTO AGENT",
      title: "Autonomous Agent",
      blurb: "Full hazard map + autopilot on the optimal path. Override anytime.",
      lives: 3,
      reveal: "full",
      agent: true,
    },
  };

  let gameMode = "classic";

  // Viewport fills the window; TILE scales so ~14 columns are on screen (big Mario-like props)
  let W = 1280;
  let H = 720;
  let TILE = 64;
  let GRAVITY = 1850;
  let MOVE_SPEED = 340;
  let RUN_SPEED = 430;
  let JUMP_VELOCITY = -860;
  let MAX_FALL = 1400;
  const COYOTE_MS = 120;
  const JUMP_BUFFER_MS = 140;
  const VIEW_COLS = 14;

  const keys = Object.create(null);
  let state = "title";
  let lastTime = 0;
  let cameraX = 0;
  let shake = 0;
  let animTime = 0;
  let score = 0;
  let lives = 3;
  let coins = 0;
  let invuln = 0;
  let particles = [];
  let floatingTexts = [];
  let agentOverride = 0;
  let agentHoldJump = false; // hold jump button through ascent for full height
  let agentPath = [];
  let pits = [];
  let jumpEdges = []; // world X positions where agent should leap

  // ---------- Level authoring ----------
  // We only hand-author the SURFACE terrain + an "air" layer. Ground body rows are
  // generated so pits/pipes always stay perfectly aligned.
  // Surface legend: # ground  . pit  P tall pipe (piranha)  p short pipe  S spike  H rotating hidden trap
  // Air legend:     C coin  ? mushroom block  ! star block  B hidden mushroom brick  = platform  E goomba  F flag
  const SURFACE_ROW = 11;
  const SURFACE = [
    "########H#", "...", "######", "PP", "########",
    "##HH##", "####", "...", "###", "##SS##",
    "######", "PP", "########", "....", "####",
    "##HH##", "######", "pp", "########", "##SS##",
    "##########", "...", "##########",
  ].join("");

  function buildLevelRows() {
    const width = SURFACE.length;
    const rows = 14;
    const grid = Array.from({ length: rows }, () => Array(width).fill("."));
    for (let c = 0; c < width; c++) grid[SURFACE_ROW][c] = SURFACE[c];
    // Body rows below the surface: solid everywhere the surface is solid, pit where the surface is a pit.
    for (const r of [12, 13]) {
      for (let c = 0; c < width; c++) grid[r][c] = SURFACE[c] === "." ? "." : "#";
    }

    const put = (r, c, ch) => {
      if (r >= 0 && r < rows && c >= 0 && c < width && grid[r][c] === ".") grid[r][c] = ch;
    };
    const putStr = (r, c, s) => {
      for (let i = 0; i < s.length; i++) put(r, c + i, s[i]);
    };

    // Coin arcs rewarding jumps + a big payday row
    putStr(6, 10, "CCC");        // over pit 1
    putStr(4, 22, "CCCCC");      // above ? blocks
    putStr(8, 30, "C");
    putStr(6, 39, "CCC");        // over pit 2
    putStr(4, 60, "CCCCC");      // above star block
    putStr(6, 67, "CCCC");       // over pit 3
    putStr(8, 82, "CC");
    putStr(6, 113, "CCC");       // over pit 4

    // Powerup blocks (bump from below)
    put(8, 23, "?");             // early mushroom
    put(8, 33, "?");
    put(8, 47, "B");             // ordinary brick hiding a mushroom
    put(7, 62, "!");             // star before the long gauntlet
    put(8, 90, "?");
    put(8, 103, "B");            // late hidden mushroom brick

    // Bridge platforms over the pits so runs feel airy + optional
    putStr(9, 39, "===");        // pit 2
    putStr(9, 67, "====");       // pit 3
    putStr(9, 113, "===");       // pit 4
    putStr(8, 51, "===");        // decorative step
    putStr(7, 81, "==");

    // Goombas patrolling the flats
    put(10, 5, "E");             // early code bug introduces the SDLC theme
    put(10, 26, "E");
    put(10, 52, "E");
    put(10, 64, "E");
    put(10, 92, "E");
    put(10, 106, "E");

    // Flag near the end
    put(10, 123, "F");

    return grid.map((a) => a.join(""));
  }

  const LEVEL_ROWS = buildLevelRows();

  let levelW = LEVEL_ROWS[0].length * TILE;
  let levelH = LEVEL_ROWS.length * TILE;
  let groundY = (LEVEL_ROWS.length - 2) * TILE;

  let solids = [];
  let platforms = [];
  let spikes = [];
  let hiddenTraps = [];
  let pipes = [];
  let piranhas = [];
  let blocks = [];
  let powerups = [];
  let coinList = [];
  let enemies = [];
  let flag = null;
  let player = null;
  let starTime = 0;
  let spawn = { x: 80, y: 0 };

  // ---------- Audio (Web Audio API, synthesized) ----------
  const AudioSys = (() => {
    let ctxAudio = null;
    let master = null;
    let musicGain = null;
    let sfxGain = null;
    let musicTimer = null;
    let musicStep = 0;
    let muted = localStorage.getItem("marioDashMuted") === "1";

    function ensure() {
      if (ctxAudio) return ctxAudio;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctxAudio = new AC();
      master = ctxAudio.createGain();
      master.gain.value = muted ? 0 : 0.7;
      master.connect(ctxAudio.destination);

      musicGain = ctxAudio.createGain();
      musicGain.gain.value = 0.18;
      musicGain.connect(master);

      sfxGain = ctxAudio.createGain();
      sfxGain.gain.value = 0.55;
      sfxGain.connect(master);
      return ctxAudio;
    }

    async function unlock() {
      const a = ensure();
      if (!a) return;
      if (a.state === "suspended") {
        try {
          await a.resume();
        } catch (_) {}
      }
      applyMute();
    }

    function applyMute() {
      if (master) master.gain.value = muted ? 0 : 0.7;
      if (muteBtn) {
        muteBtn.textContent = muted ? "🔇" : "🔊";
        muteBtn.classList.toggle("muted", muted);
      }
      localStorage.setItem("marioDashMuted", muted ? "1" : "0");
    }

    function setMuted(v) {
      muted = !!v;
      applyMute();
      if (!muted && state === "playing") startMusic();
      if (muted) stopMusic();
    }

    function toggleMute() {
      setMuted(!muted);
    }

    function tone(freq, dur, type = "square", vol = 0.3, slideTo = null, when = 0) {
      const a = ensure();
      if (!a || !sfxGain) return;
      const t0 = a.currentTime + when;
      const osc = a.createOscillator();
      const g = a.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t0);
      if (slideTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t0 + dur);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g);
      g.connect(sfxGain);
      osc.start(t0);
      osc.stop(t0 + dur + 0.02);
    }

    function noiseBurst(dur, vol = 0.2) {
      const a = ensure();
      if (!a || !sfxGain) return;
      const len = Math.floor(a.sampleRate * dur);
      const buf = a.createBuffer(1, len, a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource();
      const g = a.createGain();
      const f = a.createBiquadFilter();
      src.buffer = buf;
      f.type = "bandpass";
      f.frequency.value = 800;
      g.gain.value = vol;
      src.connect(f);
      f.connect(g);
      g.connect(sfxGain);
      src.start();
    }

    function jump() {
      tone(320, 0.12, "square", 0.22, 620);
    }

    function coin() {
      tone(988, 0.08, "square", 0.25);
      tone(1319, 0.18, "square", 0.22, null, 0.08);
    }

    function stomp() {
      tone(180, 0.08, "triangle", 0.28, 80);
      noiseBurst(0.06, 0.12);
    }

    function hurt() {
      tone(220, 0.15, "sawtooth", 0.2, 80);
      tone(160, 0.25, "square", 0.18, 60, 0.05);
    }

    function die() {
      const notes = [523, 494, 466, 440, 392, 349, 330, 262];
      notes.forEach((n, i) => tone(n, 0.14, "square", 0.2, null, i * 0.1));
    }

    function win() {
      const fanfare = [523, 659, 784, 1047, 784, 1047];
      fanfare.forEach((n, i) => tone(n, 0.16, "square", 0.24, null, i * 0.12));
    }

    // Simple looping chiptune (original, not Nintendo)
    const MELODY = [
      659, 659, 0, 659, 0, 523, 659, 0, 784, 0, 0, 0, 392, 0, 0, 0,
      523, 0, 0, 392, 0, 0, 330, 0, 0, 440, 0, 494, 0, 466, 440, 0,
      392, 659, 784, 880, 0, 698, 784, 0, 659, 0, 523, 587, 494, 0, 0, 0,
    ];

    function playMusicNote(freq) {
      const a = ensure();
      if (!a || !musicGain || muted || freq <= 0) return;
      const t0 = a.currentTime;
      const osc = a.createOscillator();
      const g = a.createGain();
      osc.type = "square";
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.35, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.14);
      osc.connect(g);
      g.connect(musicGain);
      osc.start(t0);
      osc.stop(t0 + 0.16);
    }

    function startMusic() {
      stopMusic();
      if (muted) return;
      ensure();
      musicStep = 0;
      musicTimer = setInterval(() => {
        if (state !== "playing" || muted) return;
        playMusicNote(MELODY[musicStep % MELODY.length]);
        musicStep++;
      }, 140);
    }

    function stopMusic() {
      if (musicTimer) {
        clearInterval(musicTimer);
        musicTimer = null;
      }
    }

    // Init mute button UI
    applyMute();

    return { unlock, toggleMute, setMuted, jump, coin, stomp, hurt, die, win, startMusic, stopMusic, isMuted: () => muted };
  })();

  function rect(x, y, w, h) {
    return { x, y, w, h };
  }

  function aabb(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function syncPhysicsToTile() {
    // Keep jump height / run speed consistent in tile units as TILE scales with the screen
    GRAVITY = 28 * TILE;
    JUMP_VELOCITY = -13.2 * TILE;
    MOVE_SPEED = 5.4 * TILE;
    RUN_SPEED = 7.1 * TILE;
    MAX_FALL = 22 * TILE;
  }

  function resizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = window.innerWidth;
    const cssH = window.innerHeight;
    W = Math.max(960, Math.floor(cssW));
    H = Math.max(540, Math.floor(cssH));
    // ~14 tiles across the screen so Mario & pipes read large
    TILE = Math.round(Math.min(Math.max(W / VIEW_COLS, 56), 96));
    syncPhysicsToTile();
    canvas.width = Math.floor(W * dpr);
    canvas.height = Math.floor(H * dpr);
    canvas.style.width = cssW + "px";
    canvas.style.height = cssH + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
  }

  function cellY(r, rows) {
    // Bottom-align the tile map so ground sits on the screen floor
    return H - (rows - r) * TILE;
  }

  function addSpike(x, y) {
    solids.push(rect(x, y, TILE, TILE));
    spikes.push({
      x: x + TILE * 0.1,
      y: y - TILE * 0.35,
      w: TILE * 0.8,
      h: TILE * 0.4,
      groundY: y,
      cx: x + TILE * 0.5,
      cy: y - TILE * 0.2,
    });
  }

  function addHiddenTrap(x, y, index) {
    // The ground remains completely ordinary until the trap enters its trigger radius.
    solids.push(rect(x, y, TILE, TILE));
    const types = ["edgecase", "landmine", "burrower"];
    const type = types[index % types.length];
    hiddenTraps.push({
      type,
      x: x + TILE * 0.12,
      y,
      groundY: y,
      w: TILE * 0.76,
      h: TILE * 0.68,
      cx: x + TILE * 0.5,
      state: "hidden",
      progress: 0,
      timer: 0,
      vx: 0,
      dead: false,
    });
  }

  function buildLevel() {
    solids = [];
    platforms = [];
    spikes = [];
    hiddenTraps = [];
    pipes = [];
    piranhas = [];
    blocks = [];
    powerups = [];
    coinList = [];
    enemies = [];
    pits = [];
    flag = null;
    syncPhysicsToTile();
    levelW = LEVEL_ROWS[0].length * TILE;
    levelH = LEVEL_ROWS.length * TILE;

    const rows = LEVEL_ROWS.length;
    const cols = LEVEL_ROWS[0].length;
    const pipeClaimed = Array.from({ length: rows }, () => Array(cols).fill(false));
    const groundRow = rows - 2;
    let hiddenTrapIndex = 0;
    let enemyIndex = 0;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const ch = LEVEL_ROWS[r][c];
        const x = c * TILE;
        const y = cellY(r, rows);

        if (ch === "#") {
          solids.push(rect(x, y, TILE, TILE));
        } else if (ch === "=") {
          const ph = Math.max(14, Math.round(TILE * 0.35));
          platforms.push(rect(x, y + TILE - ph, TILE, ph));
        } else if (ch === "S") {
          addSpike(x, y);
        } else if (ch === "H") {
          addHiddenTrap(x, y, hiddenTrapIndex);
          hiddenTrapIndex += 1;
        } else if ((ch === "P" || ch === "p") && !pipeClaimed[r][c]) {
          // Pipes are authored only on the surface row; they rise upward from the ground.
          let pw = 0;
          while (c + pw < cols && LEVEL_ROWS[r][c + pw] === ch && !pipeClaimed[r][c + pw]) pw++;
          for (let cc = 0; cc < pw; cc++) pipeClaimed[r][c + cc] = true;
          const stickTiles = ch === "P" ? 3 : 2; // tiles above the surface
          const topY = cellY(r - (stickTiles - 1), rows);
          const pipe = rect(x, topY, pw * TILE, H - topY); // extend down to the screen floor
          pipe.piranha = ch === "P";
          pipes.push(pipe);
          solids.push(rect(pipe.x, pipe.y, pipe.w, pipe.h));
          if (pipe.piranha) {
            const pw2 = pipe.w;
            piranhas.push({
              pipe,
              cx: pipe.x + pw2 / 2,
              topY: pipe.y,
              w: pw2 * 0.62,
              h: TILE * 1.25,
              t: Math.random() * Math.PI * 2,
              out: 0, // 0 hidden .. 1 fully emerged
            });
          }
        } else if (ch === "?" || ch === "!" || ch === "B") {
          const b = rect(x + TILE * 0.06, y + TILE * 0.06, TILE * 0.88, TILE * 0.88);
          b.type = ch === "!" ? "star" : "mushroom";
          b.brick = ch === "B";
          b.used = false;
          b.bump = 0;
          blocks.push(b);
          solids.push(b);
        } else if (ch === "C") {
          const s = TILE * 0.45;
          coinList.push({
            x: x + (TILE - s) / 2,
            y: y + (TILE - s) / 2,
            w: s,
            h: s,
            taken: false,
            bob: Math.random() * Math.PI * 2,
          });
        } else if (ch === "E") {
          const ew = TILE * 0.7;
          const eh = TILE * 0.7;
          enemies.push({
            type: enemyIndex % 3 === 0 ? "bug" : "goomba",
            x: x + (TILE - ew) / 2,
            y: y + TILE - eh,
            w: ew,
            h: eh,
            vx: -0.95 * TILE,
            vy: 0,
            dead: false,
            squish: 0,
          });
          enemyIndex += 1;
        } else if (ch === "F") {
          flag = { x: x + TILE * 0.25, y: y - TILE * 4, w: TILE * 0.3, h: TILE * 5 };
        }
      }
    }

    groundY = cellY(groundRow, rows);

    // Detect pits on the walkable ground row for agent jumps / path drawing
    const g = LEVEL_ROWS[groundRow];
    let i = 0;
    while (i < cols) {
      if (g[i] === ".") {
        const start = i;
        while (i < cols && g[i] === ".") i++;
        pits.push({ x: start * TILE, w: (i - start) * TILE, c0: start, c1: i - 1 });
      } else i++;
    }

    if (!flag) {
      const endX = levelW - TILE * 3;
      flag = { x: endX, y: groundY - TILE * 5, w: TILE * 0.3, h: TILE * 5 };
    }

    spawn = { x: TILE * 2.5, y: groundY - TILE * 0.85 };
    buildAgentPath();
  }

  function buildAgentPath() {
    agentPath = [];
    jumpEdges = [];
    const y = groundY - 4;

    // Collect raw hazard intervals
    const raw = [];
    for (const p of pits) raw.push({ start: p.x, end: p.x + p.w, kind: "pit" });
    const sortedSpikes = [...spikes].sort((a, b) => a.x - b.x);
    for (const s of sortedSpikes) {
      const last = raw[raw.length - 1];
      // Grow existing spike cluster
      if (last && last.kind === "spike" && s.x <= last.end + TILE * 0.75) {
        last.end = Math.max(last.end, s.x + s.w);
      } else {
        raw.push({ start: s.x, end: s.x + s.w, kind: "spike" });
      }
    }
    for (const t of hiddenTraps) {
      raw.push({ start: t.x, end: t.x + t.w, kind: "trap" });
    }
    raw.sort((a, b) => a.start - b.start);

    // Each hazard becomes its own jump edge (level now has landing pads between pit→spike)
    for (const h of raw) {
      jumpEdges.push({
        x: h.start - TILE * 0.2,
        clearUntil: h.end + TILE * 0.35,
        kind: h.kind,
        span: h.end - h.start,
        done: false,
      });
      agentPath.push({ x: h.start - TILE * 0.15, y });
      agentPath.push({ x: (h.start + h.end) / 2, y: y - (h.kind === "pit" ? TILE * 2.4 : TILE * 1.9) });
      agentPath.push({ x: h.end + TILE * 0.25, y });
    }

    jumpEdges.sort((a, b) => a.x - b.x);

    if (flag) {
      for (let x = TILE * 3; x < flag.x; x += TILE) {
        if (!agentPath.some((p) => Math.abs(p.x - x) < TILE * 0.4)) {
          agentPath.push({ x, y });
        }
      }
      agentPath.push({ x: flag.x + 8, y: groundY - TILE * 0.5 });
    }
    agentPath.sort((a, b) => a.x - b.x);
  }

  function spikeVisibility(s) {
    return "full";
  }

  function makePlayer() {
    return {
      x: spawn.x,
      y: spawn.y,
      w: TILE * 0.55,
      h: TILE * 0.85,
      vx: 0,
      vy: 0,
      onGround: false,
      facing: 1,
      coyote: 0,
      jumpBuf: 0,
      walkFrame: 0,
      prevVy: 0,
      super: false, // mushroom shield: survive one hit
    };
  }

  function resetRun(full = false) {
    buildLevel();
    player = makePlayer();
    cameraX = 0;
    particles = [];
    floatingTexts = [];
    invuln = 0;
    starTime = 0;
    shake = 0;
    agentOverride = 0;
    agentHoldJump = false;
    if (full) {
      score = 0;
      lives = MODES[gameMode].lives;
      coins = 0;
    }
    updateHud();
    updateAgentChip(false);
  }

  function updateHud() {
    scoreEl.textContent = String(score).padStart(6, "0");
    livesEl.textContent = String(lives);
    coinsEl.textContent = String(coins).padStart(2, "0");
    if (modeBadge) modeBadge.textContent = MODES[gameMode].label;
  }

  function setMode(modeId) {
    if (!MODES[modeId]) return;
    gameMode = modeId;
    document.querySelectorAll(".mode-card").forEach((card) => {
      card.classList.toggle("selected", card.dataset.mode === modeId);
    });
    overlayMsg.textContent = MODES[modeId].blurb;
    updateHud();
  }

  function showOverlay(title, msg, btnLabel, opts = {}) {
    overlayTitle.textContent = title;
    overlayMsg.textContent = msg;
    startBtn.textContent = btnLabel;
    const showPicker = !!opts.showPicker;
    if (modePicker) modePicker.classList.toggle("hidden", !showPicker);
    if (controlsList) controlsList.classList.toggle("hidden", false);
    overlay.classList.remove("hidden");
    updateAgentChip(false);
  }

  function hideOverlay() {
    overlay.classList.add("hidden");
  }

  function updateAgentChip(activeAutopilot) {
    if (!agentChip) return;
    if (gameMode !== "agent" || state !== "playing") {
      agentChip.classList.add("hidden");
      return;
    }
    agentChip.classList.remove("hidden");
    if (agentOverride > 0) {
      agentChip.textContent = "AGENT: MANUAL OVERRIDE";
      agentChip.classList.add("override");
    } else if (activeAutopilot) {
      agentChip.textContent = "AGENT: AUTOPILOT";
      agentChip.classList.remove("override");
    } else {
      agentChip.textContent = "AGENT: AUTOPILOT";
      agentChip.classList.remove("override");
    }
  }

  function nextJumpEdge(cx) {
    for (const edge of jumpEdges) {
      if (edge.done) continue;
      // Skip edges we've already cleared
      if (cx > edge.clearUntil) {
        edge.done = true;
        continue;
      }
      return edge;
    }
    return null;
  }

  function getControls(dt) {
    const humanLeft = !!(keys.ArrowLeft || keys.KeyA);
    const humanRight = !!(keys.ArrowRight || keys.KeyD);
    const humanJump = !!(keys.ArrowUp || keys.KeyW || keys.Space);
    const humanRun = !!(keys.ShiftLeft || keys.ShiftRight);

    if (!MODES[gameMode].agent) {
      return { left: humanLeft, right: humanRight, jump: humanJump, run: humanRun, autopilot: false };
    }

    if (humanLeft || humanRight || humanJump) {
      agentOverride = 1.25;
      agentHoldJump = false;
    }
    if (agentOverride > 0) {
      agentOverride -= dt;
      updateAgentChip(false);
      return { left: humanLeft, right: humanRight, jump: humanJump, run: humanRun, autopilot: false };
    }

    // Autopilot: run right; leap at hazards; hold jump through ascent for full height
    let left = false;
    let right = true;
    let jump = false;
    const cx = player.x + player.w * 0.55;

    if (agentHoldJump) {
      if (!player.onGround && player.vy < TILE * 0.35) {
        jump = true;
      } else if (player.vy >= 0) {
        agentHoldJump = false;
      }
    }

    if (player.onGround && !agentHoldJump) {
      const edge = nextJumpEdge(cx);
      if (edge) {
        const dist = edge.x - cx;
        // Pits need earlier takeoff; spikes jump closer to the tips
        const window = edge.kind === "pit" ? TILE * 1.55 : TILE * 1.4;
        if (dist <= window) {
          jump = true;
          agentHoldJump = true;
          // Mark done once we commit so we don't re-jump the same edge mid-pad
          if (dist < TILE * 0.5) edge.done = true;
        }
      }

      // Chain-jump: if we landed and the next hazard is already close, hop immediately
      const upcoming = nextJumpEdge(cx);
      if (!jump && upcoming && upcoming.x - cx < TILE * 1.8) {
        jump = true;
        agentHoldJump = true;
      }

      for (const e of enemies) {
        if (e.dead) continue;
        const dx = e.x - player.x;
        if (dx > TILE * 0.15 && dx < TILE * 2.3) {
          jump = true;
          agentHoldJump = true;
          break;
        }
      }

      for (const p of pipes) {
        const dx = p.x - (player.x + player.w);
        if (dx > 0 && dx < TILE * 1.05 && player.y + player.h > p.y + TILE * 0.25) {
          jump = true;
          agentHoldJump = true;
          break;
        }
      }
    }

    updateAgentChip(true);
    return { left, right, jump, run: true, autopilot: true };
  }

  window.addEventListener("keydown", (e) => {
    keys[e.code] = true;
    if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space"].includes(e.code)) {
      e.preventDefault();
    }
    if (e.code === "KeyM") {
      AudioSys.toggleMute();
      if (!AudioSys.isMuted() && state === "playing") AudioSys.startMusic();
    }
    if (e.code === "KeyP" && state === "playing") {
      state = "paused";
      AudioSys.stopMusic();
      showOverlay("PAUSED", "Take a breath. The flag still waits.", "RESUME", { showPicker: false });
    } else if (e.code === "KeyP" && state === "paused") {
      resumeGame();
    }
  });

  window.addEventListener("keyup", (e) => {
    keys[e.code] = false;
  });

  window.addEventListener("resize", () => {
    const progress = levelW > 0 && player ? player.x / levelW : 0;
    const wasGrounded = player ? player.onGround : true;
    resizeCanvas();
    buildLevel();
    if (player) {
      // Preserve progress across tile-scale changes
      player.w = TILE * 0.55;
      player.h = TILE * 0.85;
      player.x = Math.min(levelW - player.w - TILE, Math.max(TILE, progress * levelW));
      player.y = groundY - player.h;
      player.vx = 0;
      player.vy = 0;
      player.onGround = wasGrounded;
      cameraX = Math.max(0, Math.min(levelW - W, player.x - W * 0.35));
    }
  });

  muteBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    await AudioSys.unlock();
    AudioSys.toggleMute();
    if (!AudioSys.isMuted() && state === "playing") AudioSys.startMusic();
  });

  modePicker?.querySelectorAll(".mode-card").forEach((card) => {
    card.addEventListener("click", () => {
      setMode(card.dataset.mode);
    });
  });

  startBtn.addEventListener("click", async () => {
    await AudioSys.unlock();
    if (state === "title" || state === "dead" || state === "won") {
      resetRun(true);
      state = "playing";
      hideOverlay();
      lastTime = performance.now();
      AudioSys.startMusic();
      updateAgentChip(MODES[gameMode].agent);
    } else if (state === "paused") {
      resumeGame();
    }
  });

  function resumeGame() {
    state = "playing";
    hideOverlay();
    lastTime = performance.now();
    AudioSys.startMusic();
    updateAgentChip(MODES[gameMode].agent);
  }

  function burst(x, y, color, n = 10) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 80 + Math.random() * 180;
      particles.push({
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 80,
        life: 0.4 + Math.random() * 0.4,
        max: 0.8,
        color,
        size: 3 + Math.random() * 4,
      });
    }
  }

  function floatText(x, y, text, color = "#fff") {
    floatingTexts.push({ x, y, text, color, life: 0.9 });
  }

  function moveAndCollide(entity, dt) {
    entity.x += entity.vx * dt;
    for (const s of solids) {
      if (!aabb(entity, s)) continue;
      if (entity.vx > 0) entity.x = s.x - entity.w;
      else if (entity.vx < 0) entity.x = s.x + s.w;
      entity.vx = 0;
    }

    entity.y += entity.vy * dt;
    entity.onGround = false;
    for (const s of solids) {
      if (!aabb(entity, s)) continue;
      if (entity.vy > 0) {
        entity.y = s.y - entity.h;
        entity.vy = 0;
        entity.onGround = true;
      } else if (entity.vy < 0) {
        entity.y = s.y + s.h;
        entity.vy = 0;
      }
    }
  }

  function oneWayPlatforms(entity, dt) {
    if (entity.vy < 0) return;
    const feet = entity.y + entity.h;
    for (const p of platforms) {
      const wasAbove = feet - entity.vy * dt <= p.y + 3;
      if (!wasAbove) continue;
      if (
        entity.x + entity.w > p.x + 2 &&
        entity.x < p.x + p.w - 2 &&
        feet >= p.y &&
        feet <= p.y + p.h + entity.vy * dt + 6
      ) {
        entity.y = p.y - entity.h;
        entity.vy = 0;
        entity.onGround = true;
      }
    }
  }

  function hurtPlayer() {
    if (invuln > 0 || starTime > 0) return;
    // Mushroom shield: soak one hit, shrink back to small Mario instead of dying.
    if (player.super) {
      player.super = false;
      invuln = 1.4;
      shake = 8;
      AudioSys.hurt();
      burst(player.x + player.w / 2, player.y + player.h / 2, "#ffffff", 14);
      floatText(player.x, player.y - TILE * 0.3, "OW!", "#fff");
      return;
    }
    lives -= 1;
    invuln = 1.5;
    shake = 12;
    burst(player.x + player.w / 2, player.y + player.h / 2, "#ff6b6b", 18);
    updateHud();
    if (lives <= 0) {
      AudioSys.die();
      AudioSys.stopMusic();
      state = "dead";
      showOverlay(
        "GAME OVER",
        `Score ${score} · ${MODES[gameMode].title}. Try another mode or run it back.`,
        "TRY AGAIN",
        { showPicker: true }
      );
    } else {
      AudioSys.hurt();
      player.x = spawn.x;
      player.y = spawn.y;
      player.vx = 0;
      player.vy = 0;
      cameraX = Math.max(0, player.x - W * 0.35);
    }
  }

  function winGame() {
    state = "won";
    score += 1000 + lives * 200;
    updateHud();
    AudioSys.stopMusic();
    AudioSys.win();
    burst(flag.x, flag.y + 40, "#f8d030", 32);
    showOverlay(
      "YOU WIN!",
      `${MODES[gameMode].title} cleared! Final score ${score}.`,
      "PLAY AGAIN",
      { showPicker: true }
    );
  }

  function popBlock(b) {
    if (b.used) return;
    b.used = true;
    b.bump = 1;
    AudioSys.coin();
    const s = TILE * 0.62;
    powerups.push({
      x: b.x + b.w / 2 - s / 2,
      y: b.y - 2,
      w: s,
      h: s,
      vx: 0,
      vy: -TILE * 3.2,
      type: b.type,
      emerge: TILE, // rise this far out of the block before it can move
      startY: b.y,
    });
    floatText(b.x, b.y - TILE * 0.2, b.type === "star" ? "STAR!" : "SUPER!", "#fff");
  }

  function checkBlockBumps() {
    // Bumped from below: player was moving up and their head just met a block's underside.
    if (player.prevVy >= 0) return;
    const head = { x: player.x + 4, y: player.y - 2, w: player.w - 8, h: 6 };
    for (const b of blocks) {
      if (b.used) continue;
      const under = { x: b.x, y: b.y + b.h - 4, w: b.w, h: 10 };
      if (aabb(head, under)) {
        popBlock(b);
        break;
      }
    }
  }

  function grantPowerup(pu) {
    if (pu.type === "star") {
      starTime = 8;
      score += 300;
      floatText(player.x, player.y - TILE * 0.4, "INVINCIBLE!", "#f8d030");
      AudioSys.win();
    } else {
      if (!player.super) player.super = true;
      score += 500;
      floatText(player.x, player.y - TILE * 0.4, "+500", "#ff3b3b");
      AudioSys.coin();
    }
    burst(pu.x + pu.w / 2, pu.y + pu.h / 2, pu.type === "star" ? "#f8d030" : "#ff3b3b", 18);
    updateHud();
  }

  function updatePowerups(dt) {
    for (const pu of powerups) {
      if (pu.taken) continue;
      if (pu.emerge > 0) {
        // Rise cleanly out of the block first, then start behaving.
        const rise = TILE * 3.2 * dt;
        pu.y -= rise;
        pu.emerge -= rise;
        if (pu.emerge <= 0) {
          pu.emerge = 0;
          pu.vy = pu.type === "star" ? -TILE * 6 : 0;
          pu.vx = pu.type === "star" ? TILE * 2.6 : TILE * 2.2;
        }
      } else {
        pu.vy += GRAVITY * dt;
        pu.x += pu.vx * dt;
        // horizontal wall bounce
        for (const s of solids) {
          if (!aabb(pu, s)) continue;
          if (pu.vx > 0) pu.x = s.x - pu.w;
          else if (pu.vx < 0) pu.x = s.x + s.w;
          pu.vx *= -1;
          break;
        }
        pu.y += pu.vy * dt;
        for (const s of solids) {
          if (!aabb(pu, s)) continue;
          if (pu.vy > 0) {
            pu.y = s.y - pu.h;
            pu.vy = pu.type === "star" ? -TILE * 6 : 0; // stars keep bouncing
          } else if (pu.vy < 0) {
            pu.y = s.y + s.h;
            pu.vy = 0;
          }
        }
        if (pu.x < 0 || pu.x + pu.w > levelW) pu.vx *= -1;
      }
      if (aabb(player, pu)) {
        pu.taken = true;
        grantPowerup(pu);
      }
    }
    powerups = powerups.filter((p) => !p.taken);
  }

  function hiddenTrapHitbox(t) {
    if (t.type === "landmine") {
      return { x: t.cx - TILE * 0.95, y: t.groundY - TILE * 0.8, w: TILE * 1.9, h: TILE * 1.05 };
    }
    const visibleH = t.h * t.progress;
    return { x: t.x, y: t.groundY - visibleH, w: t.w, h: visibleH };
  }

  function triggerHiddenTrap(t) {
    if (t.state !== "hidden") return;
    t.state = "triggered";
    t.timer = t.type === "landmine" ? 0.48 : 0;
    t.vx = t.type === "burrower" ? (player.x < t.x ? -TILE * 2.3 : TILE * 2.3) : 0;
    floatText(t.cx - TILE * 0.18, t.groundY - TILE * 0.35, "!", "#ffef5a");
  }

  function updateHiddenTraps(dt) {
    const playerCx = player.x + player.w / 2;
    for (const t of hiddenTraps) {
      if (t.dead || t.state === "spent") continue;
      const triggerRange = t.type === "landmine" ? TILE * 0.9 : TILE * 1.45;
      if (t.state === "hidden" && Math.abs(playerCx - t.cx) < triggerRange) triggerHiddenTrap(t);
      if (t.state === "hidden") continue;

      if (t.type === "landmine") {
        t.progress = Math.min(1, t.progress + dt * 9);
        t.timer -= dt;
        if (t.timer <= 0) {
          t.state = "spent";
          shake = Math.max(shake, 14);
          burst(t.cx, t.groundY - TILE * 0.2, "#ff9d2e", 28);
          burst(t.cx, t.groundY - TILE * 0.2, "#2b221c", 16);
          if (starTime <= 0 && aabb(player, hiddenTrapHitbox(t))) hurtPlayer();
        }
        continue;
      }

      t.progress = Math.min(1, t.progress + dt * 7);
      if (t.progress < 0.28) continue;

      if (t.type === "burrower" && t.progress >= 1) {
        t.state = "active";
        const beforeX = t.x;
        t.x += t.vx * dt;
        let turn = false;
        for (const s of solids) {
          const body = hiddenTrapHitbox(t);
          if (aabb(body, s) && s.y < t.groundY - TILE * 0.2) {
            t.x = beforeX;
            turn = true;
            break;
          }
        }
        const probeX = t.vx > 0 ? t.x + t.w + 3 : t.x - 3;
        const footProbe = rect(probeX, t.groundY + 2, 4, TILE * 0.25);
        if (!solids.some((s) => aabb(footProbe, s))) turn = true;
        if (turn) t.vx *= -1;
        t.cx = t.x + t.w / 2;
      }

      const hitbox = hiddenTrapHitbox(t);
      if (!aabb(player, hitbox)) continue;
      if (starTime > 0) {
        t.dead = true;
        score += 250;
        AudioSys.stomp();
        burst(t.cx, t.groundY - t.h * 0.5, "#f8d030", 18);
        updateHud();
      } else if (
        t.type === "burrower" &&
        player.vy > 0 &&
        player.y + player.h - hitbox.y < TILE * 0.42
      ) {
        t.dead = true;
        player.vy = JUMP_VELOCITY * 0.48;
        score += 250;
        AudioSys.stomp();
        burst(t.cx, t.groundY - t.h * 0.4, "#8d4d24", 16);
        updateHud();
      } else {
        hurtPlayer();
      }
    }
  }

  function updatePiranhas(dt) {
    for (const p of piranhas) {
      p.t += dt * 1.6;
      const px = player ? player.x + player.w / 2 : -1e9;
      const nearPipe = Math.abs(px - p.cx) < TILE * 1.6;
      // Classic behavior: won't rise while Mario stands right by the pipe.
      const wantOut = !nearPipe && Math.sin(p.t) > 0;
      const target = wantOut ? (0.5 + Math.sin(p.t) * 0.5) : 0;
      p.out += (target - p.out) * Math.min(1, dt * 6);
      if (p.out < 0.05) continue;
      const emergeH = p.h * p.out;
      const hitbox = {
        x: p.cx - p.w / 2,
        y: p.topY - emergeH,
        w: p.w,
        h: emergeH,
      };
      if (player && aabb(player, hitbox)) {
        if (starTime > 0) continue;
        hurtPlayer();
      }
    }
  }

  function update(dt) {
    animTime += dt;
    if (invuln > 0) invuln -= dt;
    if (starTime > 0) starTime = Math.max(0, starTime - dt);
    if (shake > 0) shake = Math.max(0, shake - dt * 30);

    const ctl = getControls(dt);
    const left = ctl.left;
    const right = ctl.right;
    const jumpPressed = ctl.jump;
    const running = ctl.run;

    if (jumpPressed) player.jumpBuf = JUMP_BUFFER_MS / 1000;
    else player.jumpBuf = Math.max(0, player.jumpBuf - dt);

    let ax = 0;
    if (left) ax -= 1;
    if (right) ax += 1;
    if (ax !== 0) player.facing = ax;

    const maxSpeed = running ? RUN_SPEED : MOVE_SPEED;
    const target = ax * maxSpeed;
    const accel = (player.onGround ? (running ? 44 : 38) : 24) * TILE;
    if (ax !== 0) {
      player.vx += Math.sign(target - player.vx) * accel * dt;
      if (Math.abs(player.vx) > maxSpeed) player.vx = Math.sign(player.vx) * maxSpeed;
    } else {
      const friction = (player.onGround ? 40 : 7) * TILE;
      if (Math.abs(player.vx) <= friction * dt) player.vx = 0;
      else player.vx -= Math.sign(player.vx) * friction * dt;
    }

    player.vy += GRAVITY * dt;
    if (player.vy > MAX_FALL) player.vy = MAX_FALL;
    if (!jumpPressed && player.vy < -3 * TILE) player.vy *= 0.55;

    if (player.onGround) player.coyote = COYOTE_MS / 1000;
    else player.coyote = Math.max(0, player.coyote - dt);

    if (player.jumpBuf > 0 && player.coyote > 0) {
      player.vy = JUMP_VELOCITY;
      player.onGround = false;
      player.coyote = 0;
      player.jumpBuf = 0;
      AudioSys.jump();
      burst(player.x + player.w / 2, player.y + player.h, "#ffffff88", 6);
    }

    player.prevVy = player.vy;
    moveAndCollide(player, dt);
    oneWayPlatforms(player, dt);
    checkBlockBumps();
    updatePiranhas(dt);
    updateHiddenTraps(dt);
    updatePowerups(dt);
    for (const b of blocks) if (b.bump > 0) b.bump = Math.max(0, b.bump - dt * 6);

    if (player.x < 0) {
      player.x = 0;
      player.vx = 0;
    }
    if (player.x + player.w > levelW) {
      player.x = levelW - player.w;
      player.vx = 0;
    }
    if (player.y > H + 120) hurtPlayer();

    for (const s of spikes) {
      if (starTime > 0) continue;
      if (aabb(player, s)) {
        hurtPlayer();
        break;
      }
    }

    for (const c of coinList) {
      if (c.taken) continue;
      c.bob += dt * 5;
      const hit = { x: c.x, y: c.y + Math.sin(c.bob) * 5, w: c.w, h: c.h };
      if (aabb(player, hit)) {
        c.taken = true;
        coins += 1;
        score += 100;
        AudioSys.coin();
        burst(c.x + 12, c.y + 12, "#f8d030", 14);
        floatText(c.x, c.y, "+100", "#f8d030");
        updateHud();
      }
    }

    for (const e of enemies) {
      if (e.dead) {
        e.squish += dt;
        continue;
      }
      e.vy += GRAVITY * dt;
      const beforeX = e.x;
      e.x += e.vx * dt;
      let hitWall = false;
      for (const s of solids) {
        if (!aabb(e, s)) continue;
        e.x = beforeX;
        hitWall = true;
        break;
      }
      const probeX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
      const probe = rect(probeX, e.y + e.h + 2, 4, 10);
      let groundAhead = false;
      for (const s of solids) {
        if (aabb(probe, s)) {
          groundAhead = true;
          break;
        }
      }
      if (hitWall || !groundAhead) e.vx *= -1;

      e.y += e.vy * dt;
      for (const s of solids) {
        if (!aabb(e, s)) continue;
        if (e.vy > 0) {
          e.y = s.y - e.h;
          e.vy = 0;
        }
      }

      if (!aabb(player, e)) continue;

      // Star power flattens anything on contact.
      if (starTime > 0) {
        e.dead = true;
        e.squish = 0;
        score += 200;
        AudioSys.stomp();
        burst(e.x + e.w / 2, e.y + e.h / 2, e.type === "bug" ? "#7dff45" : "#f8d030", 18);
        floatText(e.x, e.y, e.type === "bug" ? "BUG FIXED!" : "+200", e.type === "bug" ? "#7dff45" : "#f8d030");
        updateHud();
        continue;
      }
      if (invuln > 0) continue;

      if (player.vy > 0 && player.y + player.h - e.y < TILE * 0.45) {
        e.dead = true;
        e.squish = 0;
        player.vy = JUMP_VELOCITY * 0.5;
        score += 200;
        AudioSys.stomp();
        burst(e.x + e.w / 2, e.y + e.h / 2, e.type === "bug" ? "#7dff45" : "#c84c0c", 16);
        floatText(e.x, e.y, e.type === "bug" ? "BUG FIXED!" : "+200", "#fff");
        updateHud();
      } else {
        hurtPlayer();
      }
    }

    const goal = rect(flag.x - 12, flag.y, 48, flag.h + 24);
    if (aabb(player, goal)) winGame();

    const targetCam = player.x - W * 0.35;
    cameraX += (targetCam - cameraX) * Math.min(1, dt * 7);
    cameraX = Math.max(0, Math.min(Math.max(0, levelW - W), cameraX));

    particles = particles.filter((p) => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 600 * dt;
      return p.life > 0;
    });
    floatingTexts = floatingTexts.filter((t) => {
      t.life -= dt;
      t.y -= 45 * dt;
      return t.life > 0;
    });
  }

  // ---------- Drawing helpers ----------
  function worldToScreen(x, y) {
    const sx = x - cameraX + (shake ? (Math.random() - 0.5) * shake : 0);
    const sy = y + (shake ? (Math.random() - 0.5) * shake : 0);
    return [sx, sy];
  }

  function px(pixels, ox, oy, scale, palette) {
    for (let y = 0; y < pixels.length; y++) {
      for (let x = 0; x < pixels[y].length; x++) {
        const ch = pixels[y][x];
        if (ch === "." || ch === " ") continue;
        const color = palette[ch];
        if (!color) continue;
        ctx.fillStyle = color;
        ctx.fillRect(ox + x * scale, oy + y * scale, scale, scale);
      }
    }
  }

  // Classic-style Mario idle/run (compact pixel sprite)
  const MARIO_IDLE = [
    "....RRRRR.....",
    "...RRRRRRRR...",
    "...HHSSHS.....",
    "..HSHSSSHS....",
    "..HSHHSSSHS...",
    "..HHSSSSS.....",
    "....SSSSSS....",
    "...RRBRRR.....",
    "..RRRBRRBRR...",
    ".RRRRBBBBRRR..",
    ".SSRBBYYBBRSS.",
    ".SSBBBBBBSBS..",
    "..BBBBBBBB....",
    "...BBB..BBB...",
    "..NNN....NNN..",
    ".NNNN....NNNN.",
  ];

  const MARIO_JUMP = [
    "....RRRRR...SS",
    "...RRRRRRRR.SS",
    "...HHSSHS.....",
    "..HSHSSSHS....",
    "..HSHHSSSHS...",
    "..HHSSSSS.....",
    "....SSSSSS.RR.",
    "...RRBRRRRRR..",
    "..RRRBRRBR....",
    ".SSRRBBBBRR...",
    "SS.BBBYYBB....",
    "....BBBBBB.N..",
    "...BBBBBBBBNN.",
    "..BBB...BBB.N.",
    ".NNN..........",
    "NNNN..........",
  ];

  const MARIO_PAL = {
    R: "#e52521",
    H: "#6a3d0a",
    S: "#f8c8a0",
    B: "#1e6cff",
    Y: "#f8d030",
    N: "#5a2d0c",
  };

  const GOOMBA = [
    "......KKKK......",
    "....KKKKKKKK....",
    "...KKKKKKKKKK...",
    "..KKEEKKKKEEKK..",
    "..KEWWKEEKWWKE..",
    ".KKEWWKEEKWWKEK.",
    ".KKEEEKEEKEEEKK.",
    ".KKKKKKKKKKKKKK.",
    ".KKSSSSSSSSKKK..",
    "..KSSSSSSSSKK...",
    "..KKKKKKKKKK....",
    "...KK....KK.....",
    "..KKKK..KKKK....",
    ".KKKKK..KKKKK...",
  ];

  const GOOMBA_PAL = {
    K: "#8b4513",
    E: "#111111",
    W: "#ffffff",
    S: "#c4a060",
  };

  function drawCloud(x, y, s) {
    ctx.fillStyle = "#ffffff";
    const bumps = [
      [0, 0, 22, 14],
      [-18, 4, 16, 12],
      [18, 5, 17, 12],
      [2, -8, 14, 12],
      [-8, -2, 12, 10],
    ];
    for (const [bx, by, bw, bh] of bumps) {
      ctx.beginPath();
      ctx.ellipse(x + bx * s, y + by * s, bw * s, bh * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Soft underside shadow
    ctx.fillStyle = "#e8f4ff";
    ctx.beginPath();
    ctx.ellipse(x, y + 8 * s, 28 * s, 8 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawHill(x, baseY, r, fill, stroke) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, baseY, r, Math.PI, 0);
    ctx.fill();
    // Classic Mario hill eyes
    ctx.fillStyle = stroke;
    const eyeY = baseY - r * 0.35;
    const eyeR = Math.max(4, r * 0.08);
    ctx.beginPath();
    ctx.arc(x - r * 0.22, eyeY, eyeR * 2.2, 0, Math.PI * 2);
    ctx.arc(x + r * 0.05, eyeY - 2, eyeR * 2.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x - r * 0.18, eyeY + 2, eyeR * 1.4, 0, Math.PI * 2);
    ctx.arc(x + r * 0.09, eyeY, eyeR * 1.4, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBush(x, y, s) {
    ctx.fillStyle = "#00a800";
    const parts = [
      [0, 0, 20, 14],
      [-16, 4, 14, 11],
      [16, 5, 14, 11],
      [0, -8, 12, 10],
    ];
    for (const [bx, by, bw, bh] of parts) {
      ctx.beginPath();
      ctx.ellipse(x + bx * s, y + by * s, bw * s, bh * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#00d000";
    ctx.beginPath();
    ctx.ellipse(x - 4 * s, y - 2 * s, 10 * s, 7 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#5c94fc");
    g.addColorStop(0.55, "#7ab0fc");
    g.addColorStop(1, "#a8d4ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // Far hills (scaled with TILE so they match the world size)
    const p1 = cameraX * 0.12;
    const hillGap = TILE * 4.5;
    for (let i = -1; i < Math.ceil(W / hillGap) + 2; i++) {
      const hx = i * hillGap - (p1 % hillGap);
      drawHill(hx + TILE, groundY + 8, TILE * 1.7, "#00a800", "#006800");
      drawHill(hx + TILE * 2.8, groundY + 8, TILE * 1.15, "#00b800", "#007000");
    }

    // Mid bushes
    const p2 = cameraX * 0.3;
    const bushGap = TILE * 2.6;
    for (let i = -1; i < Math.ceil(W / bushGap) + 2; i++) {
      const bx = i * bushGap - (p2 % bushGap);
      drawBush(bx + TILE * 0.6, groundY + 4, TILE / 48);
    }

    // Clouds
    const p3 = cameraX * 0.18;
    const cloudScale = TILE / 48;
    const clouds = [
      [140, 70, 1.2],
      [420, 120, 0.9],
      [700, 55, 1.4],
      [980, 100, 1],
      [1240, 70, 1.15],
      [1500, 130, 0.85],
    ];
    for (const [cx, cy, s] of clouds) {
      const x = ((cx * cloudScale - p3) % (W + 280)) - 60;
      drawCloud(x, cy * cloudScale + 20, s * cloudScale);
    }
  }

  function drawBrickTile(x, y, w, h) {
    ctx.fillStyle = "#c84c0c";
    ctx.fillRect(x, y, w, h);
    // Mortar grid
    ctx.strokeStyle = "#8b2e08";
    ctx.lineWidth = 2;
    const bh = 16;
    const bw = 24;
    for (let row = 0; row < h; row += bh) {
      ctx.beginPath();
      ctx.moveTo(x, y + row + 0.5);
      ctx.lineTo(x + w, y + row + 0.5);
      ctx.stroke();
      const off = (row / bh) % 2 === 0 ? 0 : bw / 2;
      for (let col = off; col < w; col += bw) {
        ctx.beginPath();
        ctx.moveTo(x + col + 0.5, y + row);
        ctx.lineTo(x + col + 0.5, y + Math.min(row + bh, h));
        ctx.stroke();
      }
    }
    // Highlight + dirt undertone
    ctx.fillStyle = "#e07030";
    ctx.fillRect(x + 1, y + 1, w - 2, 3);
    ctx.fillStyle = "#9a3a0a";
    ctx.fillRect(x, y + h - 4, w, 4);
  }

  function drawGroundTop(x, y, w) {
    const h = Math.max(6, Math.round(TILE * 0.14));
    ctx.fillStyle = "#00a800";
    ctx.fillRect(x, y - h + 2, w, h);
    ctx.fillStyle = "#00d800";
    const step = Math.max(6, Math.round(TILE * 0.16));
    for (let i = 0; i < w; i += step) {
      ctx.fillRect(x + i, y - h, Math.round(step * 0.6), Math.round(h * 0.55));
    }
  }

  function drawPlatform(p) {
    const [x, y] = worldToScreen(p.x, p.y);
    // Question-block style brick platform
    ctx.fillStyle = "#e8a830";
    ctx.fillRect(x, y, p.w, p.h);
    ctx.fillStyle = "#f8d030";
    ctx.fillRect(x + 2, y + 2, p.w - 4, 5);
    ctx.fillStyle = "#b87810";
    ctx.fillRect(x, y + p.h - 4, p.w, 4);
    ctx.strokeStyle = "#6a4000";
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, p.w - 2, p.h - 2);
    // Rivets
    ctx.fillStyle = "#fff8";
    ctx.fillRect(x + 4, y + 5, 3, 3);
    ctx.fillRect(x + p.w - 7, y + 5, 3, 3);
  }

  function drawPipe(p) {
    const [x, y] = worldToScreen(p.x, p.y);
    const lipH = Math.round(TILE * 0.42);
    const lipOut = Math.round(TILE * 0.14);
    // Mouth / lip sits on top of the pipe body (classic warp pipe)
    ctx.fillStyle = "#00a000";
    ctx.fillRect(x - lipOut, y, p.w + lipOut * 2, lipH);
    ctx.fillStyle = "#00e000";
    ctx.fillRect(x - lipOut + 3, y + 3, Math.round(p.w * 0.28), lipH - 6);
    ctx.fillStyle = "#007000";
    ctx.fillRect(x + p.w - Math.round(p.w * 0.22), y + 3, Math.round(p.w * 0.22) + lipOut - 3, lipH - 6);
    ctx.strokeStyle = "#004000";
    ctx.lineWidth = Math.max(2, Math.round(TILE / 24));
    ctx.strokeRect(x - lipOut, y, p.w + lipOut * 2, lipH);
    // Dark rim inside mouth
    ctx.fillStyle = "#003800";
    ctx.fillRect(x + 4, y + lipH - 6, p.w - 8, 5);
    // Body planted into the ground
    ctx.fillStyle = "#00b000";
    ctx.fillRect(x + 2, y + lipH - 2, p.w - 4, p.h - lipH + 2);
    ctx.fillStyle = "#00e020";
    ctx.fillRect(x + 6, y + lipH - 2, Math.round(p.w * 0.22), p.h - lipH + 2);
    ctx.fillStyle = "#006000";
    ctx.fillRect(x + p.w - Math.round(p.w * 0.2), y + lipH - 2, Math.round(p.w * 0.14), p.h - lipH + 2);
    ctx.strokeStyle = "#003000";
    ctx.strokeRect(x + 2, y + lipH - 2, p.w - 4, p.h - lipH + 2);
  }

  function drawSpike(s, style) {
    const [x, y] = worldToScreen(s.x, s.y);
    const count = 3;
    const w = s.w / count;
    for (let i = 0; i < count; i++) {
      const sx = x + i * w;
      ctx.beginPath();
      ctx.moveTo(sx, y + s.h);
      ctx.lineTo(sx + w / 2, y);
      ctx.lineTo(sx + w, y + s.h);
      ctx.closePath();
      if (style === "intel") {
        ctx.fillStyle = `rgba(80, 220, 255, ${0.35 + Math.sin(animTime * 6) * 0.15})`;
        ctx.strokeStyle = "#7af0ff";
      } else {
        const grad = ctx.createLinearGradient(sx, y, sx + w, y + s.h);
        grad.addColorStop(0, "#f0f0f5");
        grad.addColorStop(1, "#888899");
        ctx.fillStyle = grad;
        ctx.strokeStyle = "#444";
      }
      ctx.fill();
      ctx.lineWidth = style === "intel" ? 2 : 1;
      ctx.stroke();
    }
  }

  function drawHiddenTrap(t) {
    if (t.dead) return;
    const agentReveal = gameMode === "agent" && t.state === "hidden";
    if (t.state === "hidden" && !agentReveal) return;
    const [cx, gy] = worldToScreen(t.cx, t.groundY);
    const alpha = agentReveal ? 0.42 + Math.sin(animTime * 7) * 0.12 : 1;
    ctx.save();
    ctx.globalAlpha = alpha;

    if (t.type === "landmine") {
      if (t.state === "spent") {
        // Permanent blasted crater makes the detonation readable after the fact.
        ctx.fillStyle = "#3a261b";
        ctx.beginPath();
        ctx.ellipse(cx, gy - 2, TILE * 0.46, TILE * 0.15, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#130f0d";
        ctx.beginPath();
        ctx.ellipse(cx, gy - TILE * 0.03, TILE * 0.31, TILE * 0.09, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        return;
      }
      const rise = Math.max(agentReveal ? 0.18 : 0, t.progress);
      const y = gy - TILE * (0.08 + rise * 0.12);
      const pulse = 0.5 + Math.sin(animTime * 14) * 0.5;
      if (!agentReveal) {
        ctx.strokeStyle = `rgba(255,55,40,${0.25 + pulse * 0.45})`;
        ctx.lineWidth = Math.max(2, TILE * 0.035);
        ctx.beginPath();
        ctx.arc(cx, y, TILE * (0.38 + pulse * 0.16), 0, Math.PI * 2);
        ctx.stroke();
      }
      // Six pressure prongs make the object unmistakably mine-like.
      ctx.fillStyle = "#171b21";
      for (let i = 0; i < 6; i++) {
        const a = (i * Math.PI) / 3;
        ctx.save();
        ctx.translate(cx + Math.cos(a) * TILE * 0.27, y + Math.sin(a) * TILE * 0.1);
        ctx.rotate(a);
        ctx.fillRect(-TILE * 0.08, -TILE * 0.045, TILE * 0.2, TILE * 0.09);
        ctx.restore();
      }
      ctx.fillStyle = "#343b45";
      ctx.strokeStyle = agentReveal ? "#ffd84d" : "#0b0d10";
      ctx.lineWidth = Math.max(2, TILE * 0.045);
      ctx.beginPath();
      ctx.ellipse(cx, y, TILE * 0.34, TILE * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Hazard stripe, center cap, bolts and flashing detonator.
      ctx.strokeStyle = "#f0b928";
      ctx.lineWidth = Math.max(2, TILE * 0.045);
      ctx.beginPath();
      ctx.moveTo(cx - TILE * 0.2, y + TILE * 0.04);
      ctx.lineTo(cx + TILE * 0.2, y - TILE * 0.04);
      ctx.stroke();
      ctx.fillStyle = "#59636f";
      ctx.beginPath();
      ctx.arc(cx, y - TILE * 0.05, TILE * 0.105, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.timer < 0.2 && Math.floor(animTime * 22) % 2 ? "#fff" : "#ff352c";
      ctx.beginPath();
      ctx.arc(cx, y - TILE * 0.085, TILE * 0.052, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.max(7, Math.round(TILE * 0.11))}px 'Press Start 2P', monospace`;
      ctx.textAlign = "center";
      ctx.fillText("!", cx, y + TILE * 0.075);
      ctx.textAlign = "left";
    } else if (t.type === "burrower") {
      const h = t.h * (agentReveal ? 1 : t.progress);
      const x = cx - t.w / 2;
      const y = gy - h;
      const bounce = t.state === "active" ? Math.abs(Math.sin(animTime * 12)) * TILE * 0.06 : 0;
      ctx.fillStyle = "#5b2c16";
      ctx.beginPath();
      ctx.ellipse(cx, y + h * 0.55 - bounce, t.w * 0.48, h * 0.48, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e04a2f";
      ctx.fillRect(x + t.w * 0.08, y + h * 0.2 - bounce, t.w * 0.84, h * 0.18);
      ctx.fillStyle = "#fff";
      ctx.fillRect(x + t.w * 0.22, y + h * 0.4 - bounce, t.w * 0.18, h * 0.22);
      ctx.fillRect(x + t.w * 0.6, y + h * 0.4 - bounce, t.w * 0.18, h * 0.22);
      ctx.fillStyle = "#111";
      ctx.fillRect(x + t.w * 0.3, y + h * 0.46 - bounce, t.w * 0.08, h * 0.13);
      ctx.fillRect(x + t.w * 0.62, y + h * 0.46 - bounce, t.w * 0.08, h * 0.13);
      ctx.fillStyle = "#2c1710";
      ctx.fillRect(x, gy - h * 0.12, t.w * 0.36, h * 0.12);
      ctx.fillRect(x + t.w * 0.64, gy - h * 0.12, t.w * 0.36, h * 0.12);
    } else {
      // An edge case manifests as two impossible boundary brackets snapping shut.
      const h = t.h * (agentReveal ? 1 : t.progress);
      const y = gy - h;
      const snap = t.state === "hidden" ? 0 : Math.abs(Math.sin(animTime * 14)) * TILE * 0.055;
      const left = cx - t.w * 0.46 + snap;
      const right = cx + t.w * 0.46 - snap;
      const color = Math.floor(animTime * 18) % 2 ? "#ff3f75" : "#a855f7";
      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(4, TILE * 0.075);
      ctx.lineCap = "square";
      for (const [bx, dir] of [[left, 1], [right, -1]]) {
        ctx.beginPath();
        ctx.moveTo(bx + dir * t.w * 0.2, y);
        ctx.lineTo(bx, y);
        ctx.lineTo(bx, gy - TILE * 0.05);
        ctx.lineTo(bx + dir * t.w * 0.2, gy - TILE * 0.05);
        ctx.stroke();
      }
      ctx.fillStyle = "#170b2bdd";
      ctx.fillRect(cx - t.w * 0.29, y + h * 0.3, t.w * 0.58, h * 0.34);
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(cx - t.w * 0.29, y + h * 0.3, t.w * 0.58, h * 0.34);
      ctx.fillStyle = "#fff";
      ctx.font = `${Math.max(6, Math.round(TILE * 0.075))}px 'Press Start 2P', monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("EDGE", cx, y + h * 0.47);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      // Deterministic glitch fragments avoid random flicker changing every draw call.
      ctx.fillStyle = color;
      for (let i = 0; i < 5; i++) {
        const gx = cx + Math.sin(animTime * 9 + i * 2.1) * t.w * 0.52;
        const gY = y + ((i * 0.23 + animTime * 0.35) % 1) * h;
        ctx.fillRect(gx, gY, TILE * 0.08, TILE * 0.045);
      }
    }
    ctx.restore();
  }

  function drawPiranha(p) {
    if (p.out < 0.05) return;
    const emergeH = p.h * p.out;
    const cx = p.cx;
    const baseY = p.topY;
    const headY = baseY - emergeH;
    const [sx, sBaseY] = worldToScreen(cx, baseY);
    const [, sHeadY] = worldToScreen(cx, headY);
    const stemW = p.w * 0.27;
    const sway = Math.sin(animTime * 3.5 + cx * 0.01) * p.w * 0.08;
    const hx = sx + sway;
    const hy = sHeadY;
    const r = p.w * 0.54;
    const open = 0.45 + (0.5 + Math.sin(animTime * 8)) * 0.22;

    // Thick outlined stem and side leaves.
    ctx.strokeStyle = "#073d19";
    ctx.lineWidth = Math.max(2, TILE * 0.045);
    ctx.fillStyle = "#19a842";
    ctx.beginPath();
    ctx.moveTo(sx - stemW / 2, sBaseY);
    ctx.quadraticCurveTo(sx - stemW / 2 + sway, (sBaseY + sHeadY) / 2, sx - stemW / 2 + sway, sHeadY);
    ctx.lineTo(sx + stemW / 2 + sway, sHeadY);
    ctx.quadraticCurveTo(sx + stemW / 2 + sway, (sBaseY + sHeadY) / 2, sx + stemW / 2, sBaseY);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    const leafY = sBaseY - emergeH * 0.35;
    ctx.fillStyle = "#28c755";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        sx + sway * 0.4 + side * r * 0.48,
        leafY,
        r * 0.48,
        r * 0.18,
        side * -0.45,
        0,
        Math.PI * 2
      );
      ctx.fill();
      ctx.stroke();
    }

    // Red head with a heavy dark outline.
    ctx.fillStyle = "#e52521";
    ctx.strokeStyle = "#67100d";
    ctx.lineWidth = Math.max(3, TILE * 0.055);
    ctx.beginPath();
    ctx.ellipse(hx, hy, r, r * 0.92, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Large cream spots read cleanly at gameplay scale.
    ctx.fillStyle = "#fff5df";
    for (const [dx, dy, rr] of [[-0.42, -0.34, 0.2], [0.4, -0.28, 0.17], [-0.5, 0.34, 0.14], [0.5, 0.3, 0.15]]) {
      ctx.beginPath();
      ctx.arc(hx + dx * r, hy + dy * r, Math.max(2, r * rr), 0, Math.PI * 2);
      ctx.fill();
    }

    // Animated black mouth, pale lips and alternating triangular teeth.
    const mouthH = r * open;
    ctx.fillStyle = "#350507";
    ctx.beginPath();
    ctx.ellipse(hx, hy + r * 0.08, r * 0.78, mouthH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#fff1dc";
    ctx.lineWidth = Math.max(3, r * 0.13);
    ctx.beginPath();
    ctx.arc(hx, hy + r * 0.08, r * 0.76, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy + r * 0.08, r * 0.76, Math.PI * 0.08, Math.PI * 0.92);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (let i = -2; i <= 2; i++) {
      const tx = hx + i * r * 0.27;
      ctx.beginPath();
      ctx.moveTo(tx - r * 0.09, hy - mouthH * 0.6);
      ctx.lineTo(tx + r * 0.09, hy - mouthH * 0.6);
      ctx.lineTo(tx, hy - mouthH * 0.05);
      ctx.closePath();
      ctx.fill();
      if (i === -2 || i === 0 || i === 2) {
        ctx.beginPath();
        ctx.moveTo(tx - r * 0.09, hy + mouthH * 0.72);
        ctx.lineTo(tx + r * 0.09, hy + mouthH * 0.72);
        ctx.lineTo(tx, hy + mouthH * 0.18);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function drawBlock(b) {
    const [x, y] = worldToScreen(b.x, b.y - b.bump * TILE * 0.25);
    if (x + b.w < -20 || x > W + 20) return;
    if (b.used) {
      // Spent block: dull brown brick
      ctx.fillStyle = "#8a5a2b";
      ctx.fillRect(x, y, b.w, b.h);
      ctx.fillStyle = "#6b4420";
      ctx.fillRect(x + 2, y + b.h - 5, b.w - 4, 5);
      ctx.strokeStyle = "#3a2410";
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, b.w - 2, b.h - 2);
      return;
    }
    if (b.brick) {
      // Looks like a normal Mario brick; its mushroom is only revealed by a head bump.
      drawBrickTile(x, y, b.w, b.h);
      ctx.fillStyle = "#ffb25a";
      ctx.fillRect(x + 3, y + 3, b.w - 6, Math.max(2, TILE * 0.05));
      return;
    }
    const flash = 0.5 + Math.sin(animTime * 4) * 0.5;
    const isStar = b.type === "star";
    ctx.fillStyle = isStar ? `rgba(255,${120 + flash * 100},40,1)` : "#f0a020";
    ctx.fillRect(x, y, b.w, b.h);
    ctx.fillStyle = isStar ? "#ffe66a" : "#f8d030";
    ctx.fillRect(x + 3, y + 3, b.w - 6, b.h - 6);
    ctx.strokeStyle = "#7a4a10";
    ctx.lineWidth = Math.max(2, TILE / 24);
    ctx.strokeRect(x + 1, y + 1, b.w - 2, b.h - 2);
    // Rivets
    ctx.fillStyle = "#fff";
    const rv = Math.max(2, b.w * 0.06);
    for (const [rx, ry] of [[0.12, 0.12], [0.88, 0.12], [0.12, 0.88], [0.88, 0.88]]) {
      ctx.fillRect(x + rx * b.w - rv / 2, y + ry * b.h - rv / 2, rv, rv);
    }
    // Symbol
    ctx.fillStyle = "#6a3d0a";
    ctx.font = `${Math.round(b.h * 0.6)}px 'Press Start 2P', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(isStar ? "★" : "?", x + b.w / 2, y + b.h * 0.54);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function drawPowerup(pu) {
    const [x, y] = worldToScreen(pu.x, pu.y);
    if (x + pu.w < -20 || x > W + 20) return;
    const cx = x + pu.w / 2;
    const cy = y + pu.h / 2;
    if (pu.type === "star") {
      const spin = animTime * 4;
      const r = pu.w * 0.55;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.sin(spin) * 0.3);
      ctx.fillStyle = "#f8d030";
      ctx.strokeStyle = "#c88400";
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        const a2 = a + Math.PI / 5;
        ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        ctx.lineTo(Math.cos(a2) * r * 0.45, Math.sin(a2) * r * 0.45);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      // eyes
      ctx.fillStyle = "#000";
      ctx.fillRect(-r * 0.28, r * 0.02, r * 0.16, r * 0.28);
      ctx.fillRect(r * 0.12, r * 0.02, r * 0.16, r * 0.28);
      ctx.restore();
    } else {
      // Super mushroom
      const r = pu.w * 0.5;
      ctx.fillStyle = "#f4f4f4"; // stem
      ctx.fillRect(cx - r * 0.5, cy, r, r);
      ctx.fillStyle = "#e02020"; // cap
      ctx.beginPath();
      ctx.arc(cx, cy, r, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(cx - r, cy, r * 2, r * 0.35);
      ctx.fillStyle = "#fff"; // spots
      ctx.beginPath();
      ctx.arc(cx - r * 0.45, cy - r * 0.3, r * 0.24, 0, Math.PI * 2);
      ctx.arc(cx + r * 0.45, cy - r * 0.3, r * 0.24, 0, Math.PI * 2);
      ctx.arc(cx, cy - r * 0.55, r * 0.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#000"; // eyes
      ctx.fillRect(cx - r * 0.3, cy + r * 0.15, r * 0.16, r * 0.4);
      ctx.fillRect(cx + r * 0.16, cy + r * 0.15, r * 0.16, r * 0.4);
    }
  }

  function drawContextGraph() {
    if (MODES[gameMode].reveal !== "partial" && MODES[gameMode].reveal !== "full") return;

    const nodes = [];
    for (const s of spikes) {
      const vis = spikeVisibility(s);
      if (vis === "off") continue;
      nodes.push({ x: s.cx, y: s.groundY - TILE * 1.15, kind: "spike" });
    }
    for (const t of hiddenTraps) {
      if (t.dead || t.state === "spent") continue;
      nodes.push({ x: t.cx, y: t.groundY - TILE * 1.3, kind: t.type, hidden: t.state === "hidden" });
    }
    for (const e of enemies) {
      if (e.dead) continue;
      nodes.push({ x: e.x + e.w / 2, y: e.y - TILE * 0.55, kind: e.type === "bug" ? "bug" : "enemy" });
    }
    for (const p of pits) {
      nodes.push({ x: p.x + p.w / 2, y: groundY - TILE * 1.3, kind: "pit" });
    }
    for (const p of piranhas) {
      nodes.push({ x: p.cx, y: p.topY - TILE * 1.7, kind: "piranha" });
    }

    const playerCx = player.x + player.w / 2;
    const localNodes = nodes
      .filter((n) => n.x > playerCx - TILE * 1.5 && n.x < playerCx + TILE * 10)
      .map((n) => ({ ...n, distance: (n.x - playerCx) / TILE }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 5);
    if (!localNodes.length) return;

    ctx.save();
    const [hubX, hubY] = worldToScreen(playerCx, player.y - TILE * 0.35);
    const baseColor = gameMode === "agent" ? "#f8d030" : "#63e6ff";
    ctx.strokeStyle = baseColor;
    ctx.fillStyle = "#081523dd";
    ctx.lineWidth = Math.max(2, TILE * 0.04);
    ctx.beginPath();
    ctx.arc(hubX, hubY, TILE * 0.18, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    for (const n of localNodes) {
      const [x, y] = worldToScreen(n.x, n.y);
      const urgent = n.distance >= 0 && n.distance < 2.2;
      ctx.strokeStyle = urgent ? "#ff5b45" : baseColor;
      ctx.globalAlpha = urgent ? 0.9 : 0.5;
      ctx.lineWidth = urgent ? 4 : 2;
      ctx.setLineDash([6, 8]);
      ctx.lineDashOffset = -animTime * 35;
      ctx.beginPath();
      ctx.moveTo(hubX, hubY);
      ctx.quadraticCurveTo((hubX + x) / 2, Math.min(hubY, y) - TILE * 0.6, x, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;

    for (const n of localNodes) {
      const [x, y] = worldToScreen(n.x, n.y);
      if (x < -50 || x > W + 50) continue;
      drawHazardSign(x, y, n.kind, n.distance);
    }

    const nearest = localNodes.find((n) => n.distance >= 0) || localNodes[0];
    const label = hazardLabel(nearest.kind);
    const urgency = nearest.distance < 2.2 ? "DANGER" : "AHEAD";
    const bannerW = Math.min(W * 0.48, TILE * 6.8);
    const bannerX = W / 2 - bannerW / 2;
    const bannerY = Math.max(74, TILE * 0.95);
    ctx.fillStyle = nearest.distance < 2.2 ? "#4a1515e8" : "#071d2ce8";
    ctx.strokeStyle = nearest.distance < 2.2 ? "#ff5b45" : baseColor;
    ctx.lineWidth = 3;
    roundRect(bannerX, bannerY, bannerW, TILE * 0.48, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(8, Math.round(TILE * 0.12))}px 'Press Start 2P', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${urgency}: ${label} · ${Math.max(0, nearest.distance).toFixed(1)} TILES`, W / 2, bannerY + TILE * 0.24);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  function hazardLabel(kind) {
    return {
      landmine: "LANDMINE",
      edgecase: "EDGE CASE",
      burrower: "BURROWER",
      bug: "CODE BUG",
      enemy: "GOOMBA",
      piranha: "PIRANHA",
      spike: "SPIKES",
      pit: "PIT",
    }[kind] || "HAZARD";
  }

  // Player-centered graph node: icon, type and actual distance instead of decorative wiring.
  function drawHazardSign(x, y, kind, distance) {
    const bob = Math.sin(animTime * 4 + x * 0.02) * TILE * 0.06;
    const cy = y + bob;
    const s = TILE * 0.44;
    const urgent = distance >= 0 && distance < 2.2;
    const accent = urgent ? "#ff5b45" : gameMode === "agent" ? "#f8d030" : "#7af0ff";
    const board = urgent ? "#4a1515" : "#0f3a4a";

    // Post down to the hazard
    ctx.strokeStyle = accent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(2, TILE * 0.05);
    ctx.beginPath();
    ctx.moveTo(x, cy + s);
    ctx.lineTo(x, cy + s + TILE * 0.75);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // Sign board
    ctx.fillStyle = board;
    ctx.strokeStyle = accent;
    ctx.lineWidth = Math.max(2, TILE * 0.045);
    roundRect(x - s, cy - s, s * 2, s * 2, s * 0.28);
    ctx.fill();
    ctx.stroke();

    // Icon
    ctx.save();
    ctx.translate(x, cy);
    drawHazardIcon(kind, s * 0.9, accent);
    ctx.restore();

    ctx.fillStyle = "#071019e8";
    ctx.strokeStyle = accent;
    ctx.lineWidth = 2;
    roundRect(x - s * 1.2, cy + s * 0.72, s * 2.4, s * 0.5, 4);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(6, Math.round(TILE * 0.075))}px 'Press Start 2P', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${hazardLabel(kind)} ${Math.max(0, distance).toFixed(1)}`, x, cy + s * 0.97);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
  }

  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawHazardIcon(kind, s, accent) {
    if (kind === "pit") {
      // Downward chevron: "gap / fall here"
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(2, s * 0.16);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.3);
      ctx.lineTo(0, s * 0.35);
      ctx.lineTo(s * 0.5, -s * 0.3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.5, -s * 0.7);
      ctx.lineTo(0, -s * 0.05);
      ctx.lineTo(s * 0.5, -s * 0.7);
      ctx.stroke();
      return;
    }
    if (kind === "landmine") {
      ctx.fillStyle = "#252a32";
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(2, s * 0.1);
      ctx.beginPath();
      ctx.ellipse(0, s * 0.12, s * 0.58, s * 0.28, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ff3b30";
      ctx.fillRect(-s * 0.1, -s * 0.22, s * 0.2, s * 0.25);
      return;
    }
    if (kind === "edgecase") {
      ctx.strokeStyle = accent;
      ctx.lineWidth = Math.max(3, s * 0.15);
      for (const [x, dir] of [[-s * 0.2, 1], [s * 0.2, -1]]) {
        ctx.beginPath();
        ctx.moveTo(x + dir * s * 0.3, -s * 0.55);
        ctx.lineTo(x, -s * 0.55);
        ctx.lineTo(x, s * 0.55);
        ctx.lineTo(x + dir * s * 0.3, s * 0.55);
        ctx.stroke();
      }
      return;
    }
    if (kind === "bug") {
      ctx.fillStyle = "#9dff45";
      ctx.strokeStyle = "#143b16";
      ctx.lineWidth = Math.max(2, s * 0.1);
      ctx.beginPath();
      ctx.ellipse(0, 0, s * 0.38, s * 0.52, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      for (const side of [-1, 1]) {
        for (const yy of [-0.3, 0, 0.3]) {
          ctx.moveTo(side * s * 0.28, yy * s);
          ctx.lineTo(side * s * 0.62, yy * s + side * s * 0.12);
        }
      }
      ctx.stroke();
      ctx.strokeStyle = "#143b16";
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.48);
      ctx.lineTo(0, s * 0.48);
      ctx.stroke();
      return;
    }
    if (kind === "burrower") {
      ctx.fillStyle = "#5b2c16";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.56, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#e04a2f";
      ctx.fillRect(-s * 0.52, -s * 0.45, s * 1.04, s * 0.2);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-s * 0.3, -s * 0.1, s * 0.2, s * 0.25);
      ctx.fillRect(s * 0.1, -s * 0.1, s * 0.2, s * 0.25);
      return;
    }
    if (kind === "enemy") {
      // Goomba face
      ctx.fillStyle = "#8b4513";
      ctx.beginPath();
      ctx.arc(0, -s * 0.1, s * 0.55, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-s * 0.55, -s * 0.1, s * 1.1, s * 0.35);
      ctx.fillStyle = "#fff";
      ctx.fillRect(-s * 0.32, -s * 0.2, s * 0.22, s * 0.28);
      ctx.fillRect(s * 0.1, -s * 0.2, s * 0.22, s * 0.28);
      ctx.fillStyle = "#000";
      ctx.fillRect(-s * 0.24, -s * 0.14, s * 0.1, s * 0.18);
      ctx.fillRect(s * 0.16, -s * 0.14, s * 0.1, s * 0.18);
      return;
    }
    if (kind === "piranha") {
      // Piranha head
      ctx.fillStyle = "#e02020";
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.beginPath();
      ctx.arc(-s * 0.2, -s * 0.15, s * 0.12, 0, Math.PI * 2);
      ctx.arc(s * 0.22, s * 0.1, s * 0.12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#5a0000";
      ctx.fillRect(-s * 0.4, -s * 0.06, s * 0.8, s * 0.12);
      return;
    }
    // Spike fallback: skull-ish danger glyph
    ctx.fillStyle = "#151515";
    ctx.beginPath();
    ctx.arc(0, -s * 0.05, s * 0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    // fangs
    for (let i = -1; i <= 1; i++) {
      ctx.beginPath();
      ctx.moveTo(i * s * 0.28 - s * 0.08, s * 0.1);
      ctx.lineTo(i * s * 0.28 + s * 0.08, s * 0.1);
      ctx.lineTo(i * s * 0.28, s * 0.4);
      ctx.closePath();
      ctx.fill();
    }
    // eyes
    ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.arc(-s * 0.2, -s * 0.12, s * 0.1, 0, Math.PI * 2);
    ctx.arc(s * 0.2, -s * 0.12, s * 0.1, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawAgentPath() {
    if (gameMode !== "agent" || agentPath.length < 2) return;
    ctx.save();
    ctx.strokeStyle = "rgba(248, 208, 48, 0.75)";
    ctx.lineWidth = Math.max(3, TILE * 0.08);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    let started = false;
    for (const p of agentPath) {
      const [x, y] = worldToScreen(p.x, p.y);
      if (x < -60 || x > W + 60) {
        started = false;
        continue;
      }
      if (!started) {
        ctx.moveTo(x, y);
        started = true;
      } else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // Moving pulse along path near player
    const cx = player ? player.x + player.w / 2 : 0;
    for (const p of agentPath) {
      if (Math.abs(p.x - cx) > TILE * 3) continue;
      const [x, y] = worldToScreen(p.x, p.y);
      ctx.fillStyle = "#fff8";
      ctx.beginPath();
      ctx.arc(x, y, 4 + Math.sin(animTime * 8) * 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCoin(c) {
    if (c.taken) return;
    const bob = Math.sin(c.bob) * TILE * 0.08;
    const [x, y] = worldToScreen(c.x, c.y + bob);
    const squash = 0.55 + Math.abs(Math.sin(animTime * 5 + c.bob)) * 0.45;
    const rx = c.w * 0.5;
    const ry = c.h * 0.55;
    ctx.save();
    ctx.translate(x + c.w / 2, y + c.h / 2);
    ctx.scale(squash, 1);
    ctx.fillStyle = "#f8d030";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#e0a800";
    ctx.beginPath();
    ctx.ellipse(0, 0, rx * 0.45, ry * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff6";
    ctx.beginPath();
    ctx.ellipse(-rx * 0.25, -ry * 0.3, rx * 0.25, ry * 0.28, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function drawCodeBug(e, x, y) {
    const cx = x + e.w / 2;
    const cy = y + e.h * 0.5;
    const crawl = Math.sin(animTime * 13 + e.x * 0.03);
    ctx.save();
    const glow = 0.55 + Math.sin(animTime * 8) * 0.2;
    ctx.fillStyle = `rgba(126,255,69,${glow * 0.28})`;
    ctx.shadowColor = "#7dff45";
    ctx.shadowBlur = TILE * 0.22;
    ctx.beginPath();
    ctx.ellipse(cx, cy, e.w * 0.48, e.h * 0.56, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.strokeStyle = "#173b1c";
    ctx.lineWidth = Math.max(2, TILE * 0.04);
    ctx.lineCap = "round";
    // Six animated legs make this read as a crawling software bug, not another Goomba.
    for (const side of [-1, 1]) {
      for (let i = -1; i <= 1; i++) {
        const ly = cy + i * e.h * 0.2;
        const kick = crawl * side * (i === 0 ? -1 : 1) * e.w * 0.09;
        ctx.beginPath();
        ctx.moveTo(cx + side * e.w * 0.29, ly);
        ctx.lineTo(cx + side * e.w * 0.58, ly + kick);
        ctx.stroke();
      }
    }
    const shell = ctx.createLinearGradient(cx, y, cx, y + e.h);
    shell.addColorStop(0, "#c6ff55");
    shell.addColorStop(0.55, "#55d82c");
    shell.addColorStop(1, "#1e8c35");
    ctx.fillStyle = shell;
    ctx.shadowColor = "#7dff45";
    ctx.shadowBlur = TILE * 0.12;
    ctx.beginPath();
    ctx.ellipse(cx, cy, e.w * 0.38, e.h * 0.48, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "#16351b";
    ctx.beginPath();
    ctx.ellipse(cx, y + e.h * 0.18, e.w * 0.25, e.h * 0.16, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "#d9ff8a";
    ctx.lineWidth = Math.max(2, TILE * 0.025);
    ctx.beginPath();
    ctx.moveTo(cx, y + e.h * 0.22);
    ctx.lineTo(cx, y + e.h * 0.9);
    ctx.stroke();
    ctx.fillStyle = "#102715";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + side * e.w * 0.1, y + e.h * 0.15, e.w * 0.045, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.font = `${Math.max(6, Math.round(TILE * 0.07))}px 'Press Start 2P', monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("</>", cx, cy + e.h * 0.12);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.restore();
  }

  function drawEnemy(e) {
    if (e.dead && e.squish > 0.4) return;
    const [x, y] = worldToScreen(e.x, e.y);
    if (e.dead) {
      ctx.fillStyle = e.type === "bug" ? "#2d8f35" : "#4a2513";
      ctx.beginPath();
      ctx.ellipse(x + e.w / 2, y + e.h - TILE * 0.08, e.w * 0.5, TILE * 0.11, 0, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    if (e.type === "bug") {
      drawCodeBug(e, x, y);
      return;
    }
    const cx = x + e.w / 2;
    const footY = y + e.h;
    const step = Math.sin(animTime * 10 + e.x * 0.025);
    const liftLeft = Math.max(0, step) * TILE * 0.055;
    const liftRight = Math.max(0, -step) * TILE * 0.055;

    ctx.save();
    // Ground shadow and animated feet make the patrol feel planted.
    ctx.fillStyle = "#0004";
    ctx.beginPath();
    ctx.ellipse(cx, footY + 2, e.w * 0.46, e.h * 0.09, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#342016";
    ctx.strokeStyle = "#160d09";
    ctx.lineWidth = Math.max(2, TILE * 0.035);
    for (const [side, lift] of [[-1, liftLeft], [1, liftRight]]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * e.w * 0.3, footY - e.h * 0.08 - lift, e.w * 0.28, e.h * 0.12, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // Pale stalk/body beneath the oversized mushroom head.
    ctx.fillStyle = "#d8a56f";
    ctx.strokeStyle = "#3a1c0d";
    ctx.lineWidth = Math.max(2, TILE * 0.04);
    roundRect(cx - e.w * 0.3, y + e.h * 0.43, e.w * 0.6, e.h * 0.45, e.w * 0.14);
    ctx.fill();
    ctx.stroke();

    // Distinct Goomba cap with warm highlight and dark lower rim.
    const capGrad = ctx.createLinearGradient(cx, y, cx, y + e.h * 0.68);
    capGrad.addColorStop(0, "#b96a2c");
    capGrad.addColorStop(0.55, "#8b451f");
    capGrad.addColorStop(1, "#5b2a15");
    ctx.fillStyle = capGrad;
    ctx.beginPath();
    ctx.moveTo(cx - e.w * 0.5, y + e.h * 0.58);
    ctx.bezierCurveTo(cx - e.w * 0.5, y + e.h * 0.13, cx - e.w * 0.25, y, cx, y);
    ctx.bezierCurveTo(cx + e.w * 0.25, y, cx + e.w * 0.5, y + e.h * 0.13, cx + e.w * 0.5, y + e.h * 0.58);
    ctx.quadraticCurveTo(cx, y + e.h * 0.76, cx - e.w * 0.5, y + e.h * 0.58);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = "#eaa05a";
    ctx.lineWidth = Math.max(2, TILE * 0.025);
    ctx.beginPath();
    ctx.arc(cx - e.w * 0.08, y + e.h * 0.31, e.w * 0.31, Math.PI * 1.08, Math.PI * 1.72);
    ctx.stroke();

    // Angry eyes, heavy eyebrows and tiny fangs.
    ctx.fillStyle = "#fff8e8";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(cx + side * e.w * 0.19, y + e.h * 0.38, e.w * 0.12, e.h * 0.16, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "#17110d";
    ctx.fillRect(cx - e.w * 0.24, y + e.h * 0.34, e.w * 0.07, e.h * 0.15);
    ctx.fillRect(cx + e.w * 0.17, y + e.h * 0.34, e.w * 0.07, e.h * 0.15);
    ctx.strokeStyle = "#20110a";
    ctx.lineWidth = Math.max(3, TILE * 0.055);
    ctx.beginPath();
    ctx.moveTo(cx - e.w * 0.35, y + e.h * 0.25);
    ctx.lineTo(cx - e.w * 0.08, y + e.h * 0.35);
    ctx.moveTo(cx + e.w * 0.35, y + e.h * 0.25);
    ctx.lineTo(cx + e.w * 0.08, y + e.h * 0.35);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(cx + side * e.w * 0.15, y + e.h * 0.62);
      ctx.lineTo(cx + side * e.w * 0.03, y + e.h * 0.62);
      ctx.lineTo(cx + side * e.w * 0.09, y + e.h * 0.73);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFlag() {
    const [x, y] = worldToScreen(flag.x, flag.y);
    const poleW = Math.max(5, TILE * 0.12);
    // Pole
    ctx.fillStyle = "#e8e8e8";
    ctx.fillRect(x + poleW * 0.3, y, poleW, flag.h);
    ctx.fillStyle = "#aaa";
    ctx.fillRect(x + poleW * 0.3, y, poleW * 0.35, flag.h);
    // Ball
    ctx.fillStyle = "#f8d030";
    ctx.beginPath();
    ctx.arc(x + poleW * 0.8, y, TILE * 0.16, 0, Math.PI * 2);
    ctx.fill();
    // Flag
    const wave = Math.sin(animTime * 5) * TILE * 0.08;
    const flagW = TILE * 0.95;
    const flagH = TILE * 0.75;
    ctx.fillStyle = "#e52521";
    ctx.beginPath();
    ctx.moveTo(x + poleW * 1.2, y + TILE * 0.15);
    ctx.quadraticCurveTo(x + flagW + wave, y + flagH * 0.55, x + poleW * 1.2, y + flagH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    for (let i = 0; i < 5; i++) {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
      const ang2 = ang + Math.PI / 5;
      const r1 = TILE * 0.14;
      const r2 = TILE * 0.06;
      const cx = x + TILE * 0.5 + wave * 0.3;
      const cy = y + TILE * 0.42;
      if (i === 0) ctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.lineTo(cx + Math.cos(ang2) * r2, cy + Math.sin(ang2) * r2);
    }
    ctx.closePath();
    ctx.fill();
    // Base block
    drawBrickTile(x - TILE * 0.2, y + flag.h - TILE * 0.2, TILE * 0.7, TILE * 0.25);
  }

  const MARIO_STAR_PALS = [
    { R: "#ff3b3b", H: "#6a3d0a", S: "#f8c8a0", B: "#ffd23b", Y: "#fff", N: "#5a2d0c" },
    { R: "#3bff6b", H: "#6a3d0a", S: "#f8c8a0", B: "#3bd0ff", Y: "#fff", N: "#5a2d0c" },
    { R: "#3b7bff", H: "#6a3d0a", S: "#f8c8a0", B: "#ff8ad0", Y: "#fff", N: "#5a2d0c" },
    { R: "#ffd23b", H: "#6a3d0a", S: "#f8c8a0", B: "#b06bff", Y: "#fff", N: "#5a2d0c" },
  ];

  function drawPlayer() {
    if (invuln > 0 && starTime <= 0 && Math.floor(animTime * 18) % 2 === 0) return;
    const [x, y] = worldToScreen(player.x, player.y);
    const moving = Math.abs(player.vx) > TILE * 0.4 && player.onGround;
    if (moving) player.walkFrame += 0.25;

    const sprite = player.onGround ? MARIO_IDLE : MARIO_JUMP;
    // Super Mario reads a little taller; star swaps in flashing rainbow palettes.
    const grow = player.super ? 1.18 : 1;
    const scale = (player.h / 16) * grow;
    let pal = MARIO_PAL;
    if (starTime > 0) pal = MARIO_STAR_PALS[Math.floor(animTime * 16) % MARIO_STAR_PALS.length];

    ctx.save();
    ctx.translate(x + player.w / 2, y);
    ctx.scale(player.facing, 1);
    const bob = moving ? Math.abs(Math.sin(player.walkFrame)) * TILE * 0.03 : 0;
    // Anchor the sprite's feet even when Super Mario is taller.
    const oy = bob - (grow - 1) * 16 * (player.h / 16);
    px(sprite, (-16 * scale) / 2, oy, scale, pal);
    ctx.restore();

    if (starTime > 0 && starTime < 2.5 && Math.floor(animTime * 8) % 2 === 0) {
      // low-star warning shimmer handled by palette flashing; nothing extra needed
    }
  }

  function drawParticles() {
    for (const p of particles) {
      const [x, y] = worldToScreen(p.x, p.y);
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.font = "12px 'Press Start 2P', monospace";
    for (const t of floatingTexts) {
      const [x, y] = worldToScreen(t.x, t.y);
      ctx.globalAlpha = Math.max(0, t.life);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, x, y);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    drawBackground();

    // Solids (bricks), skip pipes and powerup blocks (drawn separately)
    for (const s of solids) {
      if (blocks.includes(s)) continue;
      if (pipes.some((p) => p.x === s.x && p.y === s.y && p.w === s.w && p.h === s.h)) continue;
      const [x, y] = worldToScreen(s.x, s.y);
      if (x + s.w < -40 || x > W + 40) continue;
      drawBrickTile(x, y, s.w, s.h);
      // Grass on top surface tiles near ground row
      if (Math.abs(s.y - groundY) < 2) drawGroundTop(x, y, s.w);
    }

    for (const p of platforms) {
      const [x] = worldToScreen(p.x, p.y);
      if (x + p.w < -20 || x > W + 20) continue;
      drawPlatform(p);
    }

    for (const b of blocks) drawBlock(b);

    for (const p of pipes) {
      const [x] = worldToScreen(p.x, p.y);
      if (x + p.w < -50 || x > W + 50) continue;
      drawPipe(p);
    }
    for (const p of piranhas) drawPiranha(p);
    for (const t of hiddenTraps) drawHiddenTrap(t);

    drawAgentPath();
    drawContextGraph();

    for (const s of spikes) {
      const vis = spikeVisibility(s);
      if (vis === "off") continue;
      const [x] = worldToScreen(s.x, s.y);
      if (x + s.w < -20 || x > W + 20) continue;
      drawSpike(s, vis === "intel" ? "intel" : "full");
    }

    for (const c of coinList) drawCoin(c);
    for (const pu of powerups) drawPowerup(pu);
    for (const e of enemies) drawEnemy(e);
    drawFlag();
    drawPlayer();
    drawParticles();
  }

  function loop(now) {
    const dt = Math.min(0.033, (now - lastTime) / 1000 || 0);
    lastTime = now;

    if (state === "playing") update(dt);
    else {
      animTime += dt;
      if (!player) {
        resetRun(true);
        player.vx = 0;
      }
    }

    draw();
    requestAnimationFrame(loop);
  }

  // Validate level rows
  const lens = LEVEL_ROWS.map((r) => r.length);
  if (new Set(lens).size !== 1) {
    console.warn("Level rows have uneven lengths:", lens);
  }

  resizeCanvas();
  setMode("classic");
  resetRun(true);
  showOverlay("MARIO DASH", MODES.classic.blurb, "START GAME", { showPicker: true });
  requestAnimationFrame((t) => {
    lastTime = t;
    loop(t);
  });
})();
