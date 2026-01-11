
const CONFIG = {
  goal_ms: 60000,              // >= 60s -> color emoji
  motion_threshold: 1,        // motion amount to count as "present"
  presence_hold_ms: 1500,      // allowed still time before losing presence
  blackout_ms: 2000,           // blackout cooldown duration
  cell_size: 18,               // emoji mosaic cell size

  blackWhiteEmojis: [
    { emoji: "⬛", gray: 0 },
    { emoji: "◾", gray: 55 },
    { emoji: "▪", gray: 80 },
    { emoji: "●", gray: 105 },
    { emoji: "◐", gray: 130 },
    { emoji: "◑", gray: 160 },
    { emoji: "○", gray: 190 },
    { emoji: "▫", gray: 215 },
    { emoji: "◽", gray: 235 },
    { emoji: "◻", gray: 245 },
    { emoji: "⬜", gray: 255 }
  ],

  colorEmojis: [
    { emoji: "⚫", rgb: [18,18,22] },
    { emoji: "⚪", rgb: [235,235,240] },
    { emoji: "🟤", rgb: [120,85,60] },
    { emoji: "🔴", rgb: [220,55,50] },
    { emoji: "🟠", rgb: [240,140,45] },
    { emoji: "🟡", rgb: [245,215,65] },
    { emoji: "🟢", rgb: [65,195,95] },
    { emoji: "🔵", rgb: [60,125,235] },
    { emoji: "🟣", rgb: [150,85,215] }
  ]
};


let cameraVideo = null;
let mirrorEnabled = true;

let previousFrameBuffer = null;
let lastMotionDetectedTime = 0;
let accumulatedPresenceTime = 0;
let lastFrameTime = 0;

let blackoutActive = false;
let blackoutStartTime = 0;

let runState = "WAITING"; 


function setup() {
  createCanvas(windowWidth, windowHeight);
  background(0);
  setupUI();
  updateHUDText("00:00 · motion 0.00");
}

function draw() {
  if (runState === "WAITING") {
    background(0);
    return;
  }

  if (!cameraVideo) {
    background(0);
    return;
  }

  const now = millis();
  const dt = calculateDeltaTimeMs(now);
  lastFrameTime = now;

  // Blackout cooldown (auto return after 2s)
  if (blackoutActive) {
    renderBlackoutCooldown(now);
    return;
  }

  // Motion detection
  const motionAmount = calculateMotionAmountFromCamera();
  if (motionAmount === null) {
    background(0);
    updateHUDText("00:00 · motion 0.00");
    return;
  }

  // Update last motion time
  updateLastMotionDetectedTime(now, motionAmount);

  // Presence check
  if (!isPresenceStillValid(now)) {
    enterBlackoutAndResetTimer(now, motionAmount);
    return;
  }

  // Accumulate presence time
  accumulatedPresenceTime += dt;

  // Unlock color after 60s
  let isColorUnlocked = false;
  if (accumulatedPresenceTime >= CONFIG.goal_ms) {
    isColorUnlocked = true;
  }

  // Render mosaic
  drawEmojiMosaicFromCamera(isColorUnlocked);

  // Minimal HUD (only timer + motion)
  updateHUDWhilePresent(motionAmount);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}


function setupUI() {
  const startBtn = document.getElementById("startBtn");
  const mirrorBtn = document.getElementById("mirrorBtn");
  const resetBtn = document.getElementById("resetBtn");

  if (startBtn) startBtn.onclick = startCameraCapture;
  if (mirrorBtn) mirrorBtn.onclick = toggleMirrorMode;
  if (resetBtn) resetBtn.onclick = resetSystemManually;
}

function updateHUDText(text) {
  const hud = document.getElementById("hud");
  if (hud) hud.textContent = text;
}

function startCameraCapture() {
  if (cameraVideo) return;

  // user gesture start -> best compatibility
  cameraVideo = createCapture(
    { video: { facingMode: "user" }, audio: false },
    function () {
  
    }
  );

  cameraVideo.size(640, 480);
  cameraVideo.hide();

  const startBtn = document.getElementById("startBtn");
  if (startBtn) startBtn.disabled = true;

  runState = "RUNNING";
  lastFrameTime = millis();
}

function toggleMirrorMode() {
  mirrorEnabled = !mirrorEnabled;

  const btn = document.getElementById("mirrorBtn");
  if (btn) {
    if (mirrorEnabled) btn.textContent = "🪞 Mirror: ON";
    else btn.textContent = "🪞 Mirror: OFF";
  }
}

function resetSystemManually() {
  accumulatedPresenceTime = 0;
  lastMotionDetectedTime = 0;
  previousFrameBuffer = null;

  blackoutActive = false;
  blackoutStartTime = 0;

  background(0);
  updateHUDText("00:00 · motion 0.00");
}


// TIME HELPERS

function calculateDeltaTimeMs(now) {
  if (lastFrameTime === 0) return 16;
  let dt = now - lastFrameTime;
  if (dt <= 0) dt = 16;
  return dt;
}


// PRESENCE & BLACKOUT

function updateLastMotionDetectedTime(now, motionAmount) {
  if (motionAmount >= CONFIG.motion_threshold) {
    lastMotionDetectedTime = now;
  }
}

function isPresenceStillValid(now) {
  return (now - lastMotionDetectedTime) <= CONFIG.presence_hold_ms;
}

function enterBlackoutAndResetTimer(now, motionAmount) {
  accumulatedPresenceTime = 0;
  blackoutActive = true;
  blackoutStartTime = now;

  background(0);
  // HUD stays minimal by your request
  updateHUDText("00:00 · motion 0.00");
}

function renderBlackoutCooldown(now) {
  background(0);

  // Still keep HUD minimal
  updateHUDText("00:00 · motion 0.00");

  if (now - blackoutStartTime >= CONFIG.blackout_ms) {
    blackoutActive = false;

    // reset motion reference to avoid spikes
    previousFrameBuffer = null;
    lastMotionDetectedTime = 0;
  }
}


// MOTION DETECTION

function calculateMotionAmountFromCamera() {
  if (!cameraVideo) return null;

  const smallW = 160;
  const smallH = 120;

  let frame;
  try {
    frame = cameraVideo.get();
  } catch (e) {
    return null;
  }

  if (!frame || frame.width === 0 || frame.height === 0) return null;

  frame.resize(smallW, smallH);
  frame.loadPixels();

  const pixels = frame.pixels;
  if (!pixels || pixels.length === 0) return null;

  if (!previousFrameBuffer) {
    previousFrameBuffer = new Uint8ClampedArray(pixels);
    return 999;
  }

  const perPixelThreshold = 12;
  let sum = 0;

  for (let i = 0; i < pixels.length; i += 4) {
    const dr = abs(pixels[i]     - previousFrameBuffer[i]);
    const dg = abs(pixels[i + 1] - previousFrameBuffer[i + 1]);
    const db = abs(pixels[i + 2] - previousFrameBuffer[i + 2]);

    const diff = dr + dg + db;
    if (diff > perPixelThreshold) sum += diff;
  }

  previousFrameBuffer.set(pixels);

  // normalize to a friendly number
  return sum / (smallW * smallH) / 18;
}


// EMOJI SELECTION

function selectBlackWhiteEmojiByGray(gray) {
  let bestEmoji = CONFIG.blackWhiteEmojis[0].emoji;
  let smallestDiff = 99999;

  for (let i = 0; i < CONFIG.blackWhiteEmojis.length; i++) {
    const d = abs(gray - CONFIG.blackWhiteEmojis[i].gray);
    if (d < smallestDiff) {
      smallestDiff = d;
      bestEmoji = CONFIG.blackWhiteEmojis[i].emoji;
    }
  }
  return bestEmoji;
}

function selectColorEmojiByRGB(r, g, b) {
  let bestEmoji = CONFIG.colorEmojis[0].emoji;
  let smallestDiff = 999999999;

  for (let i = 0; i < CONFIG.colorEmojis.length; i++) {
    const cr = CONFIG.colorEmojis[i].rgb[0];
    const cg = CONFIG.colorEmojis[i].rgb[1];
    const cb = CONFIG.colorEmojis[i].rgb[2];

    const d =
      (r - cr) * (r - cr) +
      (g - cg) * (g - cg) +
      (b - cb) * (b - cb);

    if (d < smallestDiff) {
      smallestDiff = d;
      bestEmoji = CONFIG.colorEmojis[i].emoji;
    }
  }
  return bestEmoji;
}


// RENDERING

function drawEmojiMosaicFromCamera(isColorUnlocked) {
  const cell = CONFIG.cell_size;
  const cols = max(12, floor(width / cell));
  const rows = max(12, floor(height / cell));

  const img = cameraVideo.get();
  img.resize(cols, rows);
  img.loadPixels();

  background(0);
  textAlign(LEFT, TOP);
  textSize(floor(cell * 1.15));
  textFont("system-ui");

  const xOffset = (width - cols * cell) * 0.5;
  const yOffset = (height - rows * cell) * 0.5;

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let sx = x;
      if (mirrorEnabled) {
        sx = cols - 1 - x;
      }

      const index = (y * cols + sx) * 4;

      const r = img.pixels[index];
      const g = img.pixels[index + 1];
      const b = img.pixels[index + 2];

      if (!isColorUnlocked) {
        const gray = round(0.299 * r + 0.587 * g + 0.114 * b);
        const emoji = selectBlackWhiteEmojiByGray(gray);
        fill(gray);
        text(emoji, xOffset + x * cell, yOffset + y * cell);
      } else {
        const emoji = selectColorEmojiByRGB(r, g, b);
        fill(255);
        text(emoji, xOffset + x * cell, yOffset + y * cell);
      }
    }
  }
}


// HUD 

function updateHUDWhilePresent(motionAmount) {
  const secondsTotal = floor(accumulatedPresenceTime / 1000);
  const minutes = floor(secondsTotal / 60);
  const seconds = secondsTotal % 60;

  const mm = (minutes < 10 ? "0" : "") + minutes;
  const ss = (seconds < 10 ? "0" : "") + seconds;

  updateHUDText(mm + ":" + ss + " · motion " + motionAmount.toFixed(2));
}
