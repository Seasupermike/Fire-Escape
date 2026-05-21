const canvas = document.querySelector("#game");
const ctx = canvas.getContext("2d");
const gameShell = document.querySelector(".game-shell");
const heightEl = document.querySelector("#height");
const bestEl = document.querySelector("#best");
const healthEl = document.querySelector("#health");
const healthMeter = document.querySelector(".health-meter");
const healthDownButton = document.querySelector("#health-down");
const healthUpButton = document.querySelector("#health-up");
const muteButton = document.querySelector("#mute");

const W = 480;
const H = 270;
const keys = new Set();
const gravity = 0.42;
const platformGap = 78;
const rngSeed = 7321;

let muted = false;
let cameraY = 0;
let lastTime = 0;
let shake = 0;
let bestHeight = readBestHeight();
let healthSetting = readHealthSetting();
let game;
let gameOverHandled = false;

const audio = {
  context: null,
  beep(freq, duration, type = "square", gain = 0.04) {
    if (muted) return;
    const AudioCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtor) return;
    this.context ??= new AudioCtor();
    const now = this.context.currentTime;
    const osc = this.context.createOscillator();
    const amp = this.context.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    amp.gain.setValueAtTime(gain, now);
    amp.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(amp).connect(this.context.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
};

function readBestHeight() {
  return readStoredNumber("fireEscapeBest", 0);
}

function readHealthSetting() {
  return Math.max(1, Math.min(9, readStoredNumber("fireEscapeHealth", 3)));
}

function readStoredNumber(key, fallback) {
  try {
    const value = Number(window.localStorage?.getItem(key));
    return Number.isFinite(value) && value > 0 ? value : fallback;
  } catch {
    return fallback;
  }
}

function saveBestHeight(value) {
  saveStoredNumber("fireEscapeBest", value);
}

function saveHealthSetting(value) {
  saveStoredNumber("fireEscapeHealth", value);
}

function saveStoredNumber(key, value) {
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Some file:// browser contexts block storage; the game should still run.
  }
}

function updateHealthDisplay() {
  healthEl.textContent = `${game.player.health}/${game.player.maxHealth}`;
}

function setHealthSetting(delta) {
  if (game.started) {
    showMessage("LOCKED", 0.7);
    canvas.focus({ preventScroll: true });
    return;
  }
  healthSetting = Math.max(1, Math.min(9, healthSetting + delta));
  saveHealthSetting(healthSetting);
  game.player.maxHealth = healthSetting;
  game.player.health = healthSetting;
  updateHealthDisplay();
  showMessage(`HEALTH ${healthSetting}`, 0.8);
  canvas.focus({ preventScroll: true });
}

function updateHealthControls() {
  const locked = game.started;
  healthMeter.classList.toggle("locked", locked);
  healthDownButton.disabled = locked || healthSetting <= 1;
  healthUpButton.disabled = locked || healthSetting >= 9;
}

function rand(n) {
  const x = Math.sin(n * 999 + rngSeed) * 10000;
  return x - Math.floor(x);
}

function reset() {
  const startPlatform = { x: 162, y: 220, w: 156, h: 9, kind: "street" };
  gameOverHandled = false;
  game = {
    state: "playing",
    time: 0,
    countdown: 0,
    started: false,
    messageTimer: 0,
    message: "",
    platforms: [startPlatform],
    pickups: [],
    platformIndex: 0,
    nextPlatformY: 148,
    lastPlatform: startPlatform,
    platformSide: 0,
    player: {
      x: 218,
      y: 184,
      w: 14,
      h: 22,
      vx: 0,
      vy: 0,
      facing: 1,
      grounded: false,
      coyote: 0,
      invincible: 0,
      height: 0,
      knockedOff: false,
      health: healthSetting,
      maxHealth: healthSetting
    },
    pigeon: {
      x: 88,
      y: 170,
      w: 19,
      h: 16,
      vx: 0,
      vy: 0,
      flap: 0,
      active: false,
      mode: "chase",
      modeTimer: 1.6,
      angle: 0,
      stunned: 0
    },
    warnings: [],
    conditioners: [],
    gusts: [],
    batman: null,
    particles: [],
    spawnTimer: 2.1,
    gustTimer: 1.2,
    batmanCheckTimer: 0,
    batmanNextHeight: 100,
    batmanCooldown: 0,
    stats: {
      hazardsDodged: 0,
      pickupsCollected: 0
    },
    summary: null,
    complete: false
  };
  cameraY = 0;
  ensurePlatforms();
  updateHealthControls();
}

function rectsHit(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function showMessage(text, seconds = 1.8) {
  game.message = text;
  game.messageTimer = seconds;
}

function togglePause() {
  if (game.state === "gameover") return;
  if (game.state === "paused") {
    game.state = "countdown";
    game.countdown = 3;
    keys.clear();
    return;
  }
  if (game.state === "countdown") {
    game.state = "paused";
    game.countdown = 0;
    keys.clear();
    return;
  }
  game.state = "paused";
  game.countdown = 0;
  keys.clear();
}

function pauseFromFocusLoss() {
  if (game.state !== "playing" && game.state !== "countdown") return;
  game.state = "paused";
  game.countdown = 0;
  keys.clear();
}

function getAltitude() {
  return Math.max(0, Math.floor(((220 - game.player.y) / 10) * 3.28084));
}

function makePlatform(y, index) {
  let variant = "normal";
  if (index > 3) {
    const roll = rand(index + 300);
    if (roll < 0.12) variant = "rusty";
    else if (roll < 0.25) variant = "moving";
    else if (roll < 0.36) variant = "narrow";
    else if (roll < 0.45) variant = "broken";
  }
  let width = 112 + Math.floor(rand(index) * 36);
  if (variant === "narrow") width = 68 + Math.floor(rand(index + 61) * 18);
  if (variant === "broken") width = 138 + Math.floor(rand(index + 62) * 22);
  game.platformSide = rand(index + 10) > 0.42 ? 1 - game.platformSide : game.platformSide;
  const xBase = game.platformSide ? 270 : 54;
  let x = xBase + Math.floor(rand(index + 20) * 36);
  const maxGap = 122;
  const previous = game.lastPlatform;
  if (x > previous.x + previous.w + maxGap) x = previous.x + previous.w + maxGap;
  if (previous.x > x + width + maxGap) x = previous.x - width - maxGap;
  x = Math.max(28, Math.min(W - width - 28, x));
  return {
    x,
    baseX: x,
    y,
    w: width,
    h: variant === "narrow" ? 6 : 8,
    kind: "escape",
    variant,
    rail: index % 3 !== 1 && variant !== "narrow" && variant !== "broken",
    phase: rand(index + 90) * Math.PI * 2,
    amplitude: variant === "moving" ? 28 + rand(index + 91) * 18 : 0,
    collapseTimer: null,
    collapseVy: 0,
    collapsed: false,
    deltaX: 0
  };
}

function getPlatformSegments(platform) {
  if (platform.collapsed) return [];
  if (platform.variant !== "broken") return [{ x: platform.x, w: platform.w }];
  const gap = 36;
  const sideW = Math.max(34, (platform.w - gap) / 2);
  return [
    { x: platform.x, w: sideW },
    { x: platform.x + sideW + gap, w: sideW }
  ];
}

function makeRescuePlatform(platform, index) {
  const width = 42;
  const minGap = 72;
  const platformCenter = platform.x + platform.w / 2;
  let x = platformCenter < W / 2
    ? W - width - 34 - Math.floor(rand(index + 700) * 42)
    : 34 + Math.floor(rand(index + 701) * 42);
  const gap = x > platform.x ? x - (platform.x + platform.w) : platform.x - (x + width);
  if (gap < minGap) {
    x = platformCenter < W / 2 ? platform.x + platform.w + minGap : platform.x - width - minGap;
  }
  x = Math.max(28, Math.min(W - width - 28, x));
  return {
    x,
    baseX: x,
    y: platform.y,
    w: width,
    h: 6,
    kind: "escape",
    variant: "rescue",
    rail: false,
    phase: rand(index + 702) * Math.PI * 2,
    amplitude: 0,
    collapseTimer: null,
    collapseVy: 0,
    collapsed: false,
    deltaX: 0
  };
}

function getLowestCatchablePlatformY() {
  let lowest = -Infinity;
  for (const platform of game.platforms) {
    if (getPlatformSegments(platform).length > 0) lowest = Math.max(lowest, platform.y);
  }
  return lowest;
}

function maybeAddHealthPickup(platform, index) {
  if (index < 3) return;
  if (game.player.health >= game.player.maxHealth) return;
  const altitude = Math.max(0, Math.floor(((220 - platform.y) / 10) * 3.28084));
  const interval = 5 + Math.floor(altitude / 70);
  if (index % interval === 2) {
    game.pickups.push({
      x: platform.x + platform.w / 2 - 7,
      y: platform.y - 20,
      w: 14,
      h: 14,
      bob: rand(index + 80) * Math.PI * 2,
      floating: false
    });
  }
  const airInterval = interval + 3;
  if (index > 5 && index % airInterval === 4) {
    const sideOffset = rand(index + 405) > 0.5 ? -28 : 28;
    game.pickups.push({
      x: Math.max(36, Math.min(W - 50, platform.x + platform.w / 2 + sideOffset - 7)),
      y: platform.y - 44 - rand(index + 406) * 18,
      w: 14,
      h: 14,
      bob: rand(index + 407) * Math.PI * 2,
      floating: true
    });
  }
}

function ensurePlatforms() {
  while (game.nextPlatformY > cameraY - H - 180) {
    const platform = makePlatform(game.nextPlatformY, game.platformIndex);
    game.platforms.push(platform);
    let nextJumpAnchor = platform;
    if (platform.variant === "rusty") {
      nextJumpAnchor = makeRescuePlatform(platform, game.platformIndex);
      game.platforms.push(nextJumpAnchor);
    }
    maybeAddHealthPickup(platform, game.platformIndex);
    game.lastPlatform = nextJumpAnchor;
    game.platformIndex += 1;
    game.nextPlatformY -= platformGap;
  }

  game.platforms = game.platforms.filter((platform) => platform.y < cameraY + H + 140);
  game.pickups = game.pickups.filter((pickup) => pickup.y < cameraY + H + 120);
}

function startRun() {
  if (game.started) return;
  game.started = true;
  game.pigeon.active = true;
  game.pigeon.x = Math.max(28, game.player.x - 132);
  game.pigeon.y = game.player.y + 8;
  game.pigeon.vx = 0.45;
  game.pigeon.vy = -0.2;
  updateHealthControls();
  showMessage("GO!", 0.7);
}

function endRun(reason) {
  if (gameOverHandled) return;
  gameOverHandled = true;
  const height = getAltitude();
  bestHeight = Math.max(bestHeight, height);
  saveBestHeight(bestHeight);
  game.state = "gameover";
  game.summary = {
    reason,
    height,
    best: bestHeight,
    hazardsDodged: game.stats.hazardsDodged,
    pickupsCollected: game.stats.pickupsCollected
  };
  showMessage("PRESS R", 999);
  audio.beep(92, 0.18, "sawtooth", 0.04);
}

function trySpawnBatman() {
  if (game.batman || game.batmanCooldown > 0 || getAltitude() < 200) return;
  if (rand(performance.now() + getAltitude() * 17) >= 0.01) return;
  const direction = rand(performance.now() + 31) > 0.5 ? 1 : -1;
  game.batman = {
    x: direction > 0 ? -70 : W + 28,
    y: game.player.y + game.player.h / 2 - 9,
    w: 58,
    h: 18,
    vx: direction * 430,
    direction,
    flap: 0,
    guaranteed: false
  };
  audio.beep(96, 0.18, "sawtooth", 0.03);
}

function knockPlayerOffMap(fromX) {
  const p = game.player;
  if (p.knockedOff) return;
  p.knockedOff = true;
  p.grounded = false;
  p.invincible = 99;
  p.vx = p.x < fromX ? -8 : 8;
  p.vy = 12;
  shake = 14;
  showMessage("KNOCKED OFF", 1.2);
  audio.beep(70, 0.22, "sawtooth", 0.06);
}

function stunPigeon(seconds = 1.4) {
  if (!game.pigeon.active) return;
  game.pigeon.mode = "stunned";
  game.pigeon.stunned = seconds;
  game.pigeon.vx *= -0.55;
  game.pigeon.vy = -3.4;
  burst(game.pigeon.x + game.pigeon.w / 2, game.pigeon.y + game.pigeon.h / 2, "#c8d6dd");
  showMessage("STUNNED", 0.8);
}

function hurtPlayer(fromX) {
  const p = game.player;
  if (p.invincible > 0) return;
  p.health -= 1;
  if (p.health <= 0) {
    burst(p.x + p.w / 2, p.y + p.h / 2, "#ffdf58");
    endRun("NO HEALTH");
    return;
  }
  p.vx = p.x < fromX ? -5.2 : 5.2;
  p.vy = -7.2;
  p.invincible = 1.7;
  shake = 8;
  showMessage(`HEALTH ${p.health}/${p.maxHealth}`, 0.9);
  audio.beep(120, 0.16, "sawtooth", 0.05);
}

function spawnWarning() {
  const altitude = getAltitude();
  const rate = Math.min(1.75, 0.95 + altitude / 95);
  game.spawnTimer = Math.max(0.72, 2.25 - rate * 0.46 + rand(Date.now() / 1000) * 0.52);
  const x = Math.max(36, Math.min(W - 54, game.player.x + game.player.vx * 20 + (rand(performance.now()) - 0.5) * 132));
  game.warnings.push({
    x,
    y: cameraY + 74,
    w: 22,
    h: 19,
    timer: 0.78,
    total: 0.78
  });
  audio.beep(660, 0.05, "triangle", 0.025);
}

function spawnGust() {
  const direction = rand(Date.now()) > 0.5 ? 1 : -1;
  const y = cameraY + 34 + rand(Date.now() / 3) * 124;
  game.gusts.push({
    x: direction > 0 ? -60 : W + 20,
    y,
    w: 94,
    h: 28,
    vx: direction * (160 + rand(y) * 76),
    life: 2.45,
    direction
  });
}

function updatePlayer(dt) {
  const p = game.player;
  const left = keys.has("ArrowLeft") || keys.has("KeyA");
  const right = keys.has("ArrowRight") || keys.has("KeyD");
  const jump = keys.has("Space") || keys.has("ArrowUp") || keys.has("KeyW");
  const accel = p.grounded ? 32 : 20;
  const drag = p.grounded ? 0.78 : 0.94;

  if (left && !p.knockedOff) {
    p.vx -= accel * dt;
    p.facing = -1;
  }
  if (right && !p.knockedOff) {
    p.vx += accel * dt;
    p.facing = 1;
  }
  if ((!left && !right) || p.knockedOff) p.vx *= drag;
  p.vx = Math.max(-4.2, Math.min(4.2, p.vx));

  p.coyote -= dt;
  if (jump && p.coyote > 0 && !p.knockedOff) {
    startRun();
    p.vy = -9.2;
    p.coyote = 0;
    p.grounded = false;
    audio.beep(360, 0.08, "square", 0.035);
  }

  for (const gust of game.gusts) {
    if (!p.knockedOff && rectsHit(p, gust)) {
      const push = 0.44 + Math.min(0.24, getAltitude() / 700);
      p.vx += gust.direction * push;
      addParticle(p.x + p.w / 2 - gust.direction * 7, p.y + 12, gust.direction > 0 ? "#eaffff" : "#b8e5ff");
    }
  }

  p.vy += gravity;
  p.vy = Math.min(10, p.vy);
  p.x += p.vx;
  p.y += p.vy;
  p.grounded = false;

  if (p.x < 8) {
    p.x = 8;
    p.vx = 0;
  }
  if (p.x + p.w > W - 8) {
    p.x = W - 8 - p.w;
    p.vx = 0;
  }

  if (!p.knockedOff) {
    for (const platform of game.platforms) {
      const wasAbove = p.y + p.h - p.vy <= platform.y + 2;
      for (const segment of getPlatformSegments(platform)) {
        if (p.vy >= 0 && wasAbove && p.x + p.w > segment.x && p.x < segment.x + segment.w && p.y + p.h >= platform.y && p.y + p.h <= platform.y + platform.h + 9) {
          p.y = platform.y - p.h;
          p.vy = 0;
          p.x += platform.deltaX || 0;
          p.grounded = true;
          p.coyote = 0.09;
          if (platform.variant === "rusty" && platform.collapseTimer === null) platform.collapseTimer = 1;
          break;
        }
      }
    }
  }

  if (p.grounded) p.coyote = 0.1;
  p.invincible = Math.max(0, p.invincible - dt);
  p.height = getAltitude();

  const lowestPlatformY = getLowestCatchablePlatformY();
  const twoHundredFeetInPixels = 200 / 3.28084 * 10;
  const passedAllSpawnedPlatforms = Number.isFinite(lowestPlatformY) && p.y > lowestPlatformY + twoHundredFeetInPixels;
  if (passedAllSpawnedPlatforms || p.y - cameraY > H + 80) {
    endRun(p.knockedOff ? "KNOCKED OFF" : "FELL");
  }
}

function updatePigeon(dt) {
  if (!game.pigeon.active) return;
  const bird = game.pigeon;
  const p = game.player;
  const altitude = Math.min(500, getAltitude());
  const speed = 0.013 + Math.min(0.072, altitude / 10666.67);
  const topSpeed = 1.18 + Math.min(3.85, altitude / 273.33);

  if (bird.mode === "stunned") {
    bird.stunned -= dt;
    bird.vy += gravity * 0.75;
    if (bird.stunned <= 0) {
      bird.mode = "chase";
      bird.modeTimer = 1.4;
    }
  } else {
    bird.modeTimer -= dt;
    if (bird.modeTimer <= 0) {
      const roll = rand(game.time + bird.x + bird.y);
      if (roll < 0.18) {
        bird.mode = "pause";
        bird.modeTimer = 0.7;
      } else if (roll < 0.36) {
        bird.mode = "circle";
        bird.modeTimer = 1.2;
      } else if (roll < 0.52) {
        bird.mode = "dive";
        bird.modeTimer = 0.75;
      } else {
        bird.mode = "chase";
        bird.modeTimer = 1.7;
      }
    }

    const dx = p.x - bird.x;
    const dy = p.y - bird.y;
    if (bird.mode === "pause") {
      bird.vx *= 0.92;
      bird.vy += Math.sin(game.time * 8) * 0.018;
    } else if (bird.mode === "circle") {
      bird.angle += dt * 4.5;
      const tx = p.x + Math.cos(bird.angle) * 54;
      const ty = p.y + Math.sin(bird.angle) * 34;
      bird.vx += (tx - bird.x) * speed * 0.85 * dt;
      bird.vy += (ty - bird.y) * speed * 0.85 * dt;
    } else if (bird.mode === "dive") {
      bird.vx += Math.sign(dx || 1) * speed * 95 * dt;
      bird.vy += (dy > 0 ? 1 : -0.25) * speed * 120 * dt;
    } else {
      bird.vx += Math.sign(dx) * speed * 46 * dt;
      bird.vy += Math.sign(dy) * speed * 36 * dt;
      bird.vx += dx * speed * 0.62 * dt;
      bird.vy += dy * speed * 0.62 * dt;
    }
    bird.vx *= 0.966;
    bird.vy *= 0.968;
    bird.vx = Math.max(-topSpeed, Math.min(topSpeed, bird.vx));
    bird.vy = Math.max(-topSpeed, Math.min(topSpeed, bird.vy));
  }

  bird.x += bird.vx;
  bird.y += bird.vy;
  bird.flap += dt * (6.5 + altitude / 42);
  if (bird.mode !== "stunned" && rectsHit(bird, p)) hurtPlayer(bird.x + bird.w / 2);
}

function updatePickups(dt) {
  for (let i = game.pickups.length - 1; i >= 0; i--) {
    const pickup = game.pickups[i];
    pickup.bob += dt * 5;
    if (game.player.health < game.player.maxHealth && rectsHit(game.player, pickup)) {
      game.player.health += 1;
      game.stats.pickupsCollected += 1;
      burst(pickup.x + pickup.w / 2, pickup.y + pickup.h / 2, "#8effa7");
      showMessage("+HEALTH", 0.9);
      audio.beep(620, 0.1, "triangle", 0.035);
      game.pickups.splice(i, 1);
    }
  }
}

function updatePlatforms(dt) {
  for (const platform of game.platforms) {
    platform.deltaX = 0;
    if (platform.variant === "moving" && !platform.collapsed) {
      const previousX = platform.x;
      platform.x = platform.baseX + Math.sin(game.time * 1.15 + platform.phase) * platform.amplitude;
      platform.x = Math.max(24, Math.min(W - platform.w - 24, platform.x));
      platform.deltaX = platform.x - previousX;
    }
    if (platform.collapseTimer !== null && !platform.collapsed) {
      platform.collapseTimer -= dt;
      if (platform.collapseTimer <= 0) {
        platform.collapsed = true;
        platform.collapseVy = 0.8;
        burst(platform.x + platform.w / 2, platform.y, "#c77555");
      }
    }
    if (platform.collapsed) {
      platform.collapseVy += 0.22;
      platform.y += platform.collapseVy;
    }
  }
}

function updateBatman(dt) {
  if (!game.started) return;
  game.batmanCooldown = Math.max(0, game.batmanCooldown - dt);

  if (!game.batman) {
    game.batmanCheckTimer += dt;
    if (game.batmanCheckTimer >= 10) {
      game.batmanCheckTimer = 0;
      trySpawnBatman();
    }
    while (getAltitude() >= game.batmanNextHeight) {
      game.batmanNextHeight += 100;
      trySpawnBatman();
    }
    return;
  }

  const batman = game.batman;
  batman.y += (game.player.y + game.player.h / 2 - batman.h / 2 - batman.y) * 0.35;
  batman.x += batman.vx * dt;
  batman.flap += dt * 12;
  const crossedPlayer = batman.direction > 0 ? batman.x + batman.w >= game.player.x : batman.x <= game.player.x + game.player.w;
  if (rectsHit(batman, game.player) || (batman.guaranteed && crossedPlayer)) {
    knockPlayerOffMap(batman.x + batman.w / 2);
  }
  if (batman.x < -110 || batman.x > W + 110) {
    game.batman = null;
    if (!game.player.knockedOff) {
      game.stats.hazardsDodged += 1;
      game.batmanCooldown = 100;
    }
  }
}

function updateHazards(dt) {
  if (game.started) {
    game.spawnTimer -= dt;
    if (game.spawnTimer <= 0 && !game.complete) spawnWarning();
  }

  for (let i = game.warnings.length - 1; i >= 0; i--) {
    const warning = game.warnings[i];
    warning.timer -= dt;
    warning.y = cameraY + 74;
    if (warning.timer <= 0) {
      game.conditioners.push({
        x: warning.x - 4,
        y: cameraY - 38,
        w: 30,
        h: 22,
        vy: 0,
        spin: 0
      });
      game.warnings.splice(i, 1);
    }
  }

  for (let i = game.conditioners.length - 1; i >= 0; i--) {
    const ac = game.conditioners[i];
    ac.vy += 0.32;
    ac.y += ac.vy;
    ac.spin += dt * 12;
    if (rectsHit(ac, game.player)) {
      hurtPlayer(ac.x + ac.w / 2);
      burst(ac.x + ac.w / 2, ac.y + ac.h / 2, "#c8d6dd");
      game.conditioners.splice(i, 1);
      continue;
    }
    const fiftyFeetInPixels = 50 / 3.28084 * 10;
    const pigeonTooFarBelow = game.pigeon.y + game.pigeon.h / 2 > game.player.y + game.player.h / 2 + fiftyFeetInPixels;
    if (game.pigeon.active && game.pigeon.mode !== "stunned" && !pigeonTooFarBelow && rectsHit(ac, game.pigeon)) {
      stunPigeon();
      game.conditioners.splice(i, 1);
      continue;
    }
    if (ac.y > cameraY + H + 60) {
      game.stats.hazardsDodged += 1;
      game.conditioners.splice(i, 1);
    }
  }

  if (getAltitude() > 72 && !game.complete) {
    game.gustTimer -= dt;
    if (game.gustTimer <= 0) {
      game.gustTimer = 1.35 + rand(Date.now() / 7) * 1.15;
      spawnGust();
    }
  }

  for (let i = game.gusts.length - 1; i >= 0; i--) {
    const gust = game.gusts[i];
    gust.x += gust.vx * dt;
    gust.life -= dt;
    if (gust.life <= 0 || gust.x < -150 || gust.x > W + 150) {
      game.stats.hazardsDodged += 1;
      game.gusts.splice(i, 1);
    }
  }
}

function addParticle(x, y, color) {
  if (game.particles.length > 90) return;
  game.particles.push({
    x,
    y,
    vx: (rand(x + y + Date.now()) - 0.5) * 1.6,
    vy: (rand(y - x + Date.now()) - 0.5) * 1.2,
    life: 0.42,
    color
  });
}

function burst(x, y, color) {
  for (let i = 0; i < 16; i++) addParticle(x, y, i % 3 ? color : "#fff0a8");
  audio.beep(82, 0.14, "sawtooth", 0.055);
}

function updateParticles(dt) {
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const pt = game.particles[i];
    pt.x += pt.vx;
    pt.y += pt.vy;
    pt.life -= dt;
    if (pt.life <= 0) game.particles.splice(i, 1);
  }
}

function update(dt) {
  if (game.state === "paused") {
    game.messageTimer = 0;
    updateHealthDisplay();
    updateHealthControls();
    return;
  }
  if (game.state === "countdown") {
    game.countdown -= dt;
    if (game.countdown <= 0) {
      game.state = "playing";
      game.countdown = 0;
      showMessage("GO!", 0.45);
    }
    updateHealthDisplay();
    updateHealthControls();
    return;
  }
  game.time += dt;
  if (game.state === "gameover") {
    game.messageTimer = 999;
    updateHealthDisplay();
    updateHealthControls();
    return;
  }
  ensurePlatforms();
  updatePlatforms(dt);
  updatePlayer(dt);
  updatePigeon(dt);
  updatePickups(dt);
  updateHazards(dt);
  updateBatman(dt);
  updateParticles(dt);
  const targetY = game.player.y - 150;
  cameraY += (targetY - cameraY) * 0.08;
  cameraY = Math.min(0, cameraY);
  shake = Math.max(0, shake - dt * 18);
  game.messageTimer = Math.max(0, game.messageTimer - dt);

  const alt = getAltitude();
  bestHeight = Math.max(bestHeight, alt);
  saveBestHeight(bestHeight);
  heightEl.textContent = `${alt}ft`;
  bestEl.textContent = `${bestHeight}ft`;
  updateHealthDisplay();
  updateHealthControls();
}

function drawRect(x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y - cameraY), Math.round(w), Math.round(h));
}

function drawPixelText(text, x, y, size = 2, color = "#f8e6bd", align = "left") {
  ctx.save();
  ctx.font = `${8 * size}px monospace`;
  ctx.textAlign = align;
  ctx.textBaseline = "top";
  ctx.fillStyle = "#111827";
  ctx.fillText(text, x + size, y + size);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function backgroundPalette() {
  return { sky: "#263852", haze: "#536b7c", wall: "#50434a", lit: "#f1c27a", dark: "#282a38" };
}

function drawBackground() {
  const pal = backgroundPalette();
  ctx.fillStyle = pal.sky;
  ctx.fillRect(0, 0, W, H);

  const horizon = Math.round(205 + cameraY * 0.04);
  ctx.fillStyle = pal.haze;
  ctx.fillRect(0, Math.max(0, horizon), W, H - horizon);

  for (let layer = 0; layer < 3; layer++) {
    const yOff = ((cameraY * (0.06 + layer * 0.05)) % 80 + 80) % 80;
    const baseY = 150 + layer * 35 + yOff;
    ctx.fillStyle = layer === 0 ? "#131b2b" : layer === 1 ? "#1d2738" : "#263248";
    for (let i = -1; i < 10; i++) {
      const bw = 36 + ((i * 17 + layer * 11) % 36);
      const bh = 56 + ((i * 29 + layer * 7) % 80);
      const x = i * 58 + layer * 13;
      ctx.fillRect(x, baseY - bh, bw, bh);
      ctx.fillStyle = layer === 2 ? "#f2d48a" : "#84abc0";
      for (let wy = baseY - bh + 10; wy < baseY - 8; wy += 18) {
        if ((wy + i + layer) % 3 === 0) ctx.fillRect(x + 8, wy, 5, 6);
        if ((wy + i) % 4 === 0) ctx.fillRect(x + bw - 14, wy, 5, 6);
      }
      ctx.fillStyle = layer === 0 ? "#131b2b" : layer === 1 ? "#1d2738" : "#263248";
    }
  }

  const wallX = 12;
  const wallW = W - 24;
  ctx.fillStyle = pal.wall;
  ctx.fillRect(wallX, Math.round(-cameraY * 0.08) - 28, wallW, H + 80);
  ctx.fillStyle = pal.dark;
  ctx.fillRect(wallX, 0, 8, H);
  ctx.fillRect(wallX + wallW - 8, 0, 8, H);

  const brickY = Math.floor(cameraY / 18) * 18;
  for (let y = brickY - 18; y < cameraY + H + 18; y += 18) {
    const sy = Math.round(y - cameraY);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(wallX + 8, sy, wallW - 16, 1);
    for (let x = wallX + 22 + ((y / 18) % 2) * 16; x < wallX + wallW - 20; x += 32) {
      ctx.fillRect(x, sy, 1, 9);
    }
  }

  const firstWindowY = Math.floor((cameraY - 120) / 86) * 86;
  for (let y = firstWindowY; y < cameraY + H + 120; y += 86) {
    const row = Math.floor(y / 86);
    for (let x = 58; x < W - 60; x += 78) {
      const lit = (row + x) % 4 === 0;
      drawWindow(x, y + (row % 2) * 10, lit ? pal.lit : "#192236");
    }
  }

}

function drawWindow(x, y, color) {
  drawRect(x, y, 24, 26, "#171b27");
  drawRect(x + 3, y + 3, 8, 8, color);
  drawRect(x + 14, y + 3, 7, 8, color);
  drawRect(x + 3, y + 14, 8, 8, color);
  drawRect(x + 14, y + 14, 7, 8, color);
}

function drawPlatform(platform) {
  const y = platform.y - cameraY;
  if (y < -28 || y > H + 30) return;
  const variantColors = {
    normal: "#586579",
    moving: "#4f79a8",
    narrow: "#7b8796",
    rescue: "#92a1aa",
    rusty: "#9a5b42",
    broken: "#655d61"
  };
  const main = platform.kind === "street" ? "#3a4655" : variantColors[platform.variant] || "#586579";
  const segments = getPlatformSegments(platform);
  for (const segment of segments) {
    drawRect(segment.x, platform.y, segment.w, platform.h, main);
    drawRect(segment.x, platform.y + platform.h, segment.w, 4, platform.variant === "rusty" ? "#5a2f2b" : "#242b36");
  }
  if (platform.kind === "escape") {
    for (let x = platform.x + 8; x < platform.x + platform.w - 3; x += 15) {
      drawRect(x, platform.y + 4, 2, 20, "#29313b");
      if (platform.rail) drawRect(x, platform.y - 13, 2, 13, "#6f7c8a");
    }
    if (platform.rail) {
      drawRect(platform.x + 4, platform.y - 13, platform.w - 8, 2, "#8b98a8");
      drawRect(platform.x + 4, platform.y - 7, platform.w - 8, 2, "#6f7c8a");
    }
    for (const segment of segments) {
      for (let x = segment.x + 6; x < segment.x + segment.w - 8; x += 12) {
        drawRect(x, platform.y + 3, 7, 2, platform.variant === "rusty" ? "#d39161" : "#9aa6af");
      }
    }
    if (platform.variant === "moving") {
      drawRect(platform.x + platform.w / 2 - 10, platform.y + 15, 20, 3, "#9ed3ff");
      drawRect(platform.x + platform.w / 2 - 3, platform.y + 11, 6, 11, "#2d4259");
    }
    if (platform.variant === "rusty" && platform.collapseTimer !== null && !platform.collapsed) {
      const warnW = Math.max(8, platform.w * Math.max(0, platform.collapseTimer));
      drawRect(platform.x, platform.y - 4, warnW, 2, "#ffdf58");
    }
    if (platform.variant === "broken") {
      drawRect(platform.x + platform.w / 2 - 12, platform.y + 2, 8, 2, "#1b202a");
      drawRect(platform.x + platform.w / 2 + 4, platform.y + 4, 8, 2, "#1b202a");
    }
    if (platform.variant === "narrow" || platform.variant === "rescue") {
      drawRect(platform.x + 4, platform.y - 4, platform.w - 8, 2, "#c2ccd2");
    }
  }
  if (platform.kind === "roof") {
    drawRect(platform.x + 12, platform.y - 18, 32, 18, "#39424c");
    drawRect(platform.x + 98, platform.y - 30, 12, 30, "#2a323b");
    drawRect(platform.x + 93, platform.y - 35, 22, 5, "#6d7b86");
  }
}

function drawPlayer() {
  const p = game.player;
  const blink = p.invincible > 0 && Math.floor(performance.now() / 75) % 2 === 0;
  if (blink) return;
  const sx = Math.round(p.x);
  const sy = Math.round(p.y - cameraY);
  const skin = "#d9a065";
  const coat = "#3fb5a8";
  const dark = "#15242c";
  const pants = "#273b69";
  drawRect(sx + 4, p.y, 8, 7, skin);
  drawRect(sx + (p.facing > 0 ? 10 : 3), p.y + 2, 2, 2, "#10151c");
  drawRect(sx + 3, p.y + 7, 10, 9, coat);
  drawRect(sx + (p.facing > 0 ? 12 : 0), p.y + 9, 3, 8, skin);
  drawRect(sx + 3, p.y + 16, 4, 6, pants);
  drawRect(sx + 9, p.y + 16, 4, 6, pants);
  drawRect(sx + 2, p.y + 21, 5, 2, dark);
  drawRect(sx + 9, p.y + 21, 5, 2, dark);
  drawRect(sx + 2, p.y - 2, 11, 3, "#382a2a");
}

function drawPigeon() {
  if (!game.pigeon.active) return;
  const bird = game.pigeon;
  const wing = Math.sin(bird.flap) > 0 ? -7 : 4;
  drawRect(bird.x + 4, bird.y + 4, 14, 9, "#8c95a2");
  drawRect(bird.x + 13, bird.y + 2, 6, 6, "#aeb8c2");
  drawRect(bird.x + 18, bird.y + 4, 4, 2, "#e9bc55");
  drawRect(bird.x + 16, bird.y + 3, 2, 2, "#10151c");
  drawRect(bird.x + 7, bird.y + wing, 10, 5, "#66717f");
  drawRect(bird.x + 5, bird.y + 13, 2, 3, "#db8c56");
  drawRect(bird.x + 12, bird.y + 13, 2, 3, "#db8c56");
}

function drawBatman() {
  const batman = game.batman;
  if (!batman) return;
  const y = batman.y + Math.sin(batman.flap) * 2;
  const sx = batman.x;
  const bodyX = sx + batman.w / 2 - 5;
  drawRect(sx + 2, y + 8, 18, 4, "#05070d");
  drawRect(sx + 38, y + 8, 18, 4, "#05070d");
  drawRect(sx + 9, y + 5, 14, 5, "#0c1020");
  drawRect(sx + 35, y + 5, 14, 5, "#0c1020");
  drawRect(bodyX, y + 4, 10, 12, "#161a2a");
  drawRect(bodyX + 2, y + 1, 6, 5, "#070a12");
  drawRect(bodyX + 1, y, 2, 3, "#070a12");
  drawRect(bodyX + 7, y, 2, 3, "#070a12");
  drawRect(bodyX + (batman.direction > 0 ? 8 : 0), y + 4, 3, 3, "#f2d98b");
  drawRect(sx + 15, y + 12, 28, 6, "#070a12");
}

function drawPickups() {
  for (const pickup of game.pickups) {
    const y = pickup.y + Math.sin(pickup.bob) * 2;
    if (y - cameraY < -24 || y - cameraY > H + 24) continue;
    if (pickup.floating) {
      drawRect(pickup.x - 5, y + 6, 3, 3, "#fff0a8");
      drawRect(pickup.x + 16, y + 3, 3, 3, "#fff0a8");
      drawRect(pickup.x + 15, y + 14, 2, 2, "#a8fff1");
    }
    drawRect(pickup.x + 3, y, 8, 14, "#e9fff0");
    drawRect(pickup.x, y + 3, 14, 8, "#e9fff0");
    drawRect(pickup.x + 5, y + 2, 4, 10, "#3fc66c");
    drawRect(pickup.x + 2, y + 5, 10, 4, "#3fc66c");
    drawRect(pickup.x + 2, y + 12, 10, 2, "#7aa88a");
  }
}

function drawWarningsAndHazards() {
  for (const warning of game.warnings) {
    const pulse = Math.floor(warning.timer * 12) % 2 === 0;
    drawRect(warning.x, warning.y, warning.w, warning.h, pulse ? "#ffdf58" : "#ff6b4a");
    drawRect(warning.x + 9, warning.y + 4, 4, 8, "#17202b");
    drawRect(warning.x + 9, warning.y + 14, 4, 3, "#17202b");
    drawRect(warning.x - 3, warning.y + warning.h, warning.w + 6, 3, "#241b20");
  }

  for (const ac of game.conditioners) {
    drawRect(ac.x, ac.y, ac.w, ac.h, "#b8c4cc");
    drawRect(ac.x + 3, ac.y + 3, ac.w - 6, 5, "#e4eef0");
    drawRect(ac.x + 5, ac.y + 11, 20, 7, "#647180");
    for (let x = ac.x + 7; x < ac.x + 24; x += 5) drawRect(x, ac.y + 12, 2, 5, "#2c3540");
    drawRect(ac.x + 2, ac.y + ac.h, ac.w - 4, 3, "#67727d");
  }
}

function drawGusts() {
  for (const gust of game.gusts) {
    const sy = gust.y - cameraY;
    if (sy < -40 || sy > H + 40) continue;
    ctx.globalAlpha = Math.max(0, Math.min(0.75, gust.life / 1.2));
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? "#ecfbff" : "#a8d9ea";
      ctx.fillRect(Math.round(gust.x + i * 18), Math.round(sy + i * 5), 36, 3);
      ctx.fillRect(Math.round(gust.x + i * 18 + gust.direction * 8), Math.round(sy + i * 5 + 5), 20, 2);
    }
    ctx.globalAlpha = 1;
  }
}

function drawParticles() {
  for (const pt of game.particles) {
    ctx.globalAlpha = Math.max(0, pt.life / 0.42);
    drawRect(pt.x, pt.y, 3, 3, pt.color);
    ctx.globalAlpha = 1;
  }
}

function drawOverlay() {
  if (game.summary) {
    ctx.fillStyle = "rgba(12, 16, 26, 0.88)";
    ctx.fillRect(48, 38, 384, 198);
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 2;
    ctx.strokeRect(48, 38, 384, 198);
    drawPixelText(game.summary.reason, W / 2, 54, 3.2, "#fff0a8", "center");
    drawPixelText(`HEIGHT ${game.summary.height}ft`, W / 2, 104, 2, "#a8fff1", "center");
    drawPixelText(`BEST ${game.summary.best}ft`, W / 2, 128, 2, "#f8e6bd", "center");
    drawPixelText(`DODGED ${game.summary.hazardsDodged}`, W / 2, 154, 2, "#d7f7ff", "center");
    drawPixelText(`PICKUPS ${game.summary.pickupsCollected}`, W / 2, 178, 2, "#8effa7", "center");
    drawPixelText("PRESS R TO RETRY", W / 2, 210, 2, "#ffdf58", "center");
    return;
  }
  if (game.state === "paused") {
    ctx.fillStyle = "rgba(12, 16, 26, 0.72)";
    ctx.fillRect(0, 0, W, H);
    drawPixelText("PAUSED", W / 2, 84, 3, "#fff0a8", "center");
    drawPixelText("PRESS P TO RESUME", W / 2, 120, 1.6, "#a8fff1", "center");
    return;
  }
  if (game.state === "countdown") {
    ctx.fillStyle = "rgba(12, 16, 26, 0.48)";
    ctx.fillRect(0, 0, W, H);
    drawPixelText(`${Math.ceil(game.countdown)}`, W / 2, 82, 5, "#fff0a8", "center");
    drawPixelText("GET READY", W / 2, 132, 1.6, "#a8fff1", "center");
    return;
  }
  if (!game.started) {
    drawPixelText("FIRE ESCAPE", W / 2, 76, 3, "#ff3b30", "center");
    drawPixelText("MOVE: A/D OR ARROWS", W / 2, 120, 2, "#a8fff1", "center");
    drawPixelText("JUMP: SPACE / W / UP", W / 2, 144, 2, "#a8fff1", "center");
  }
  if (game.messageTimer > 0) {
    drawPixelText(game.message, W / 2, 54, 3, "#fff0a8", "center");
  }
}

function render() {
  ctx.save();
  const jx = shake ? Math.round((rand(performance.now()) - 0.5) * shake) : 0;
  const jy = shake ? Math.round((rand(performance.now() + 99) - 0.5) * shake) : 0;
  ctx.translate(jx, jy);
  ctx.imageSmoothingEnabled = false;
  drawBackground();
  drawGusts();
  for (const platform of game.platforms) drawPlatform(platform);
  drawWarningsAndHazards();
  drawPickups();
  drawParticles();
  drawPlayer();
  drawPigeon();
  drawBatman();
  drawOverlay();
  ctx.restore();
}

function loop(time) {
  const dt = Math.min(0.033, (time - lastTime) / 1000 || 0);
  lastTime = time;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

window.addEventListener("keydown", (event) => {
  if (["ArrowLeft", "ArrowRight", "ArrowUp", "Space", "KeyP"].includes(event.code)) event.preventDefault();
  canvas.focus({ preventScroll: true });
  if (game.state === "gameover" && ["KeyR", "Space", "Enter"].includes(event.code)) {
    reset();
    return;
  }
  if (event.code === "KeyP" && !event.repeat) {
    togglePause();
    return;
  }
  if (game.state !== "playing") return;
  keys.add(event.code);
  if (audio.context?.state === "suspended") audio.context.resume();
});

window.addEventListener("keyup", (event) => {
  keys.delete(event.code);
});

for (const button of document.querySelectorAll(".touch-button")) {
  const code = button.dataset.key;
  const press = (event) => {
    event.preventDefault();
    keys.add(code);
  };
  const release = (event) => {
    event.preventDefault();
    keys.delete(code);
  };
  button.addEventListener("pointerdown", press);
  button.addEventListener("pointerup", release);
  button.addEventListener("pointercancel", release);
  button.addEventListener("pointerleave", release);
}

muteButton.addEventListener("click", () => {
  muted = !muted;
  muteButton.textContent = muted ? "×" : "♪";
});

healthDownButton.addEventListener("click", () => setHealthSetting(-1));
healthUpButton.addEventListener("click", () => setHealthSetting(1));

canvas.addEventListener("pointerdown", () => {
  canvas.focus({ preventScroll: true });
});

window.addEventListener("blur", pauseFromFocusLoss);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) pauseFromFocusLoss();
});

gameShell.addEventListener("focusout", () => {
  requestAnimationFrame(() => {
    if (!gameShell.contains(document.activeElement)) pauseFromFocusLoss();
  });
});

reset();
bestEl.textContent = `${bestHeight}ft`;
updateHealthDisplay();
canvas.focus({ preventScroll: true });
requestAnimationFrame(loop);
