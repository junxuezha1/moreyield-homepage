import { mountPhaserInterior } from "./src/phaser-interior/index.js";
import { createCharacterWalker } from "./src/character-walk-v3.js";
import { createSceneTransitionCoordinator } from "./src/interior-exterior-transition.js";
import { createBackgroundMusic } from "./src/background-music.js";
import { createSoundEffects } from "./src/sound-effects.js";

const experience = document.querySelector("#experience");
const scene = document.querySelector("#scene");
const finalIntegrationHost = document.querySelector("#finalIntegrationHost");
const background = document.querySelector("#sceneBackground");
const mountainTitle = document.querySelector("#mountainTitle");
const player = document.querySelector("#player");
const playerSprite = document.querySelector(".player__sprite");
const enterButton = document.querySelector("#enterButton");
const enterLabel = document.querySelector("#enterLabel");
const journeyFeedback = document.querySelector("#journeyFeedback");
const journeyLabel = document.querySelector("#journeyLabel");
const skipButton = document.querySelector("#skipButton");
const worldTransition = document.querySelector("#worldTransition");
const replayButton = document.querySelector("#replayButton");
const statusText = document.querySelector("#statusText");
if (window.location.hostname === "world.moreyield.cn") {
  document.querySelector("[data-personal-home]").href = "https://moreyield.cn/";
}
const soundEffects = createSoundEffects();
const music = createBackgroundMusic({
  audio: document.querySelector("#backgroundMusic"),
  button: document.querySelector("#musicButton"),
  onEnabledChange: (enabled) => soundEffects.setEnabled(enabled)
});
const playSound = (name) => soundEffects[name]?.();

document.addEventListener("pointerdown", () => { void soundEffects.unlock(); }, { capture: true, passive: true });
document.addEventListener("keydown", (event) => {
  if (!event.repeat) void soundEffects.unlock();
}, { capture: true });
document.addEventListener("click", (event) => {
  const control = event.target instanceof Element ? event.target.closest("button, a") : null;
  if (!control || control.disabled || control.id === "musicButton" || control.matches(".phaser-interior__touch-button")) return;
  soundEffects.interact();
}, { capture: true });

const SOURCE_WIDTH = 1280;
const SOURCE_HEIGHT = 720;
const EXTERIOR_MAP_ZOOM = 0.94;
const PORTAL_X = 0.727;
const EXTERIOR_GROUND_PROFILE = [
  { x: 0, y: 548 },
  { x: 128, y: 546 },
  { x: 256, y: 550 },
  { x: 384, y: 549 },
  { x: 512, y: 551 },
  { x: 640, y: 550 },
  { x: 730, y: 547 },
  { x: 800, y: 542 },
  { x: 850, y: 536 },
  { x: 890, y: 530 },
  { x: 931, y: 527 },
  { x: 960, y: 530 },
  { x: 1280, y: 548 }
];
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

let phase = "loading";
let runId = 0;
let completedRunId = -1;
let completionEventCount = 0;
let sceneMetrics = null;
let playerX = 0.28;
let finalIntegration = null;
let exteriorWalker = null;
let interiorMounting = false;
let exteriorReturning = false;
let skipRequested = false;
let retryTarget = "exterior";
const transitions = createSceneTransitionCoordinator();
const INTERACTIVE_SELECTOR = "button, a, input, textarea, select, [contenteditable='true'], [role='button']";
const JOURNEY_PHASES = Object.freeze({
  awaken: "唤醒中",
  walking: "前往传送门",
  portal: "正在穿越",
  complete: "载入世界",
  "loading-interior": "载入世界",
  returning: "返回外景"
});

experience.style.setProperty("--exterior-map-zoom", String(EXTERIOR_MAP_ZOOM));
experience.style.setProperty("--exterior-actor-size-compensation", String(1 / EXTERIOR_MAP_ZOOM));

function isInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest(INTERACTIVE_SELECTOR));
}

function syncExteriorControls() {
  const showEnter = phase === "idle" || phase === "error";
  const showReplay = phase === "complete" || phase === "interior";
  enterButton.hidden = !showEnter;
  enterButton.disabled = !showEnter;
  replayButton.hidden = !showReplay;
  replayButton.disabled = !showReplay;
}

function syncJourneyFeedback() {
  const label = JOURNEY_PHASES[phase];
  journeyFeedback.hidden = !label;
  journeyLabel.textContent = label || "";
  skipButton.hidden = !["awaken", "walking", "portal", "complete"].includes(phase);
}

function setPhase(nextPhase, announcement) {
  phase = nextPhase;
  experience.dataset.phase = nextPhase;
  if (announcement) statusText.textContent = announcement;
  syncExteriorControls();
  syncJourneyFeedback();
}

function setPlayerPosition(x) {
  playerX = x;
  player.style.left = `${x * 100}%`;
  player.style.top = `${(surfaceYAt(x * SOURCE_WIDTH) / SOURCE_HEIGHT) * 100}%`;
}

function surfaceYAt(sourceX) {
  const x = Math.max(0, Math.min(SOURCE_WIDTH, Number(sourceX) || 0));
  for (let index = 1; index < EXTERIOR_GROUND_PROFILE.length; index += 1) {
    const from = EXTERIOR_GROUND_PROFILE[index - 1];
    const to = EXTERIOR_GROUND_PROFILE[index];
    if (x <= to.x) {
      const progress = (x - from.x) / Math.max(1, to.x - from.x);
      return from.y + (to.y - from.y) * progress;
    }
  }
  return EXTERIOR_GROUND_PROFILE.at(-1).y;
}

function destroyExteriorWalker() {
  exteriorWalker?.destroy();
  exteriorWalker = null;
}

function createExteriorWalker() {
  destroyExteriorWalker();
  exteriorWalker = createCharacterWalker({
    element: playerSprite,
    actor: "player"
  });
  exteriorWalker.ready.then(() => {
    if (exteriorWalker) {
      const { footAnchor, frameSize } = exteriorWalker.snapshot();
      player.style.setProperty("--player-foot-offset", `${-(footAnchor.y / frameSize.height) * 100}%`);
    }
  });
  return exteriorWalker;
}

function layoutScene() {
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const sourceWidth = background.naturalWidth || SOURCE_WIDTH;
  const sourceHeight = background.naturalHeight || SOURCE_HEIGHT;
  const coverScale = Math.max(viewportWidth / sourceWidth, viewportHeight / sourceHeight);
  const scale = coverScale * EXTERIOR_MAP_ZOOM;
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  const isPortrait = viewportHeight > viewportWidth * 1.08;

  const left = isPortrait
    ? viewportWidth * 0.66 - width * PORTAL_X
    : (viewportWidth - width) / 2;
  const top = (viewportHeight - height) / 2;
  const visibleStartX = Math.max(0.14, Math.min(0.58, (-left + viewportWidth * 0.12) / width));

  sceneMetrics = { coverScale, height, left, mapZoom: EXTERIOR_MAP_ZOOM, scale, top, visibleStartX, width };
  scene.style.width = `${width}px`;
  scene.style.height = `${height}px`;
  scene.style.left = `${left}px`;
  scene.style.top = `${top}px`;

  // The title stays at the viewport center even when the portrait map is cropped.
  const titleWidth = Math.min(width * 0.59, viewportWidth * 0.91);
  mountainTitle.style.width = `${titleWidth}px`;
  mountainTitle.style.left = `${viewportWidth / 2 - left}px`;
  mountainTitle.style.top = `${viewportHeight / 2 - top}px`;

  const portalScreenX = left + width * PORTAL_X;
  const portalScreenY = top + height * 0.572;
  experience.style.setProperty("--portal-screen-x", `${portalScreenX}px`);
  experience.style.setProperty("--portal-screen-y", `${portalScreenY}px`);

  if (["loading", "idle", "awaken"].includes(phase)) {
    setPlayerPosition(visibleStartX);
  }
}

function wait(duration, id, { skippable = true } = {}) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    const frame = (now) => {
      if (id !== runId) {
        resolve(false);
        return;
      }
      if ((skippable && skipRequested) || now - startedAt >= duration) {
        resolve(true);
        return;
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  });
}

function delay(duration) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

function easeInOutCubic(value) {
  return value < 0.5
    ? 4 * value * value * value
    : 1 - Math.pow(-2 * value + 2, 3) / 2;
}

function animateWalk(startX, endX, duration, id) {
  return new Promise((resolve) => {
    const startedAt = performance.now();
    let previousX = startX;
    let stepDistance = 0;

    function frame(now) {
      if (id !== runId) {
        resolve(false);
        return;
      }

      if (skipRequested) {
        setPlayerPosition(endX);
        player.style.setProperty("--entry-scale", "0.72");
        player.style.opacity = "0";
        player.dataset.entering = "true";
        resolve(true);
        return;
      }

      const rawProgress = Math.min(1, (now - startedAt) / duration);
      const progress = easeInOutCubic(rawProgress);
      const nextX = startX + (endX - startX) * progress;
      setPlayerPosition(nextX);
      stepDistance += Math.abs(nextX - previousX) * SOURCE_WIDTH;
      previousX = nextX;
      if (stepDistance >= 28 && rawProgress < 0.78) {
        stepDistance %= 28;
        soundEffects.step();
      }

      const entryProgress = Math.max(0, (rawProgress - 0.78) / 0.22);
      player.style.setProperty("--entry-scale", String(1 - entryProgress * 0.32));
      player.style.opacity = String(1 - Math.pow(entryProgress, 1.5));
      player.dataset.entering = entryProgress > 0.02 ? "true" : "false";

      if (rawProgress < 1) {
        requestAnimationFrame(frame);
      } else {
        resolve(true);
      }
    }

    requestAnimationFrame(frame);
  });
}

async function activate() {
  if (phase !== "idle") return;
  void soundEffects.unlock();
  music.start();
  soundEffects.interact();

  const id = ++runId;
  skipRequested = false;
  const motionScale = reducedMotion.matches ? 0.35 : 1;
  setPhase("awaken", "角色正在唤醒");
  player.dataset.visible = "true";
  player.dataset.awake = "true";

  if (!(await wait(680 * motionScale, id))) return;
  setPhase("walking", "角色正在走向传送门");
  player.classList.add("is-walking");
  exteriorWalker?.setState("walk-right");

  const startX = sceneMetrics?.visibleStartX ?? playerX;
  const destinationX = PORTAL_X - 0.004;
  const distance = Math.max(0.08, destinationX - startX);
  const duration = Math.max(2300, Math.min(4700, distance * 9800)) * motionScale;
  const completed = await animateWalk(startX, destinationX, duration, id);
  if (!completed) return;

  player.classList.remove("is-walking");
  destroyExteriorWalker();
  setPhase("portal", "角色已进入传送门");

  if (!(await wait(1500 * motionScale, id))) return;
  player.dataset.visible = "false";
  player.style.opacity = "";
  setPhase("complete", "外景启动动画播放完成");

  if (completedRunId !== id) {
    completedRunId = id;
    window.dispatchEvent(new CustomEvent("yunxing:exterior-complete", { detail: { runId: id } }));
  }
}

function reset() {
  runId += 1;
  skipRequested = false;
  transitions.reset("exterior");
  createExteriorWalker();
  exteriorWalker?.setState("idle");
  player.classList.remove("is-walking");
  player.dataset.visible = "true";
  player.dataset.awake = "false";
  player.dataset.entering = "false";
  player.style.opacity = "";
  player.style.setProperty("--entry-scale", "1");
  setPlayerPosition(sceneMetrics?.visibleStartX ?? 0.28);
  retryTarget = "exterior";
  enterLabel.textContent = "开始探索";
  enterButton.setAttribute("aria-label", "开始探索");
  enterButton.title = "开始探索";
  setPhase("idle", "选择开始探索");
}

function replay() {
  finalIntegration?.destroy();
  finalIntegration = null;
  finalIntegrationHost.hidden = true;
  scene.hidden = false;
  reset();
  window.requestAnimationFrame(activate);
}

function showExteriorReturn() {
  exteriorReturning = false;
  interiorMounting = false;
  finalIntegration?.destroy();
  finalIntegration = null;
  finalIntegrationHost.hidden = true;
  scene.hidden = false;
  createExteriorWalker();
  exteriorWalker?.setState("idle");
  player.classList.remove("is-walking");
  player.dataset.visible = "true";
  player.dataset.awake = "true";
  player.dataset.entering = "false";
  player.style.opacity = "";
  player.style.setProperty("--entry-scale", "1");
  setPlayerPosition(0.723);
  retryTarget = "exterior";
  enterLabel.textContent = "再次探索";
  enterButton.setAttribute("aria-label", "再次探索");
  enterButton.title = "再次探索";
  setPhase("idle", "已返回外景，可再次进入传送门");
  enterButton.focus({ preventScroll: true });
}

async function returnToExterior(detail = {}) {
  if (exteriorReturning || phase !== "interior") return;
  exteriorReturning = true;
  setPhase("returning", "正在返回外景");
  worldTransition.hidden = false;
  worldTransition.dataset.mode = "exit";

  await delay(reducedMotion.matches ? 260 : 560);
  const exit = transitions.transition("exterior", {
    trigger: detail.reason || "return-gate-control"
  });
  if (!exit.ok) {
    exteriorReturning = false;
    worldTransition.hidden = true;
    delete worldTransition.dataset.mode;
    setPhase("interior", "返回外景失败，仍停留在内景");
    return;
  }

  showExteriorReturn();
  worldTransition.dataset.mode = "reveal";
  await delay(reducedMotion.matches ? 180 : 520);
  worldTransition.hidden = true;
  delete worldTransition.dataset.mode;
}

async function mountInterior() {
  if (finalIntegration || interiorMounting) return finalIntegration;
  interiorMounting = true;
  statusText.textContent = "正在载入内景地形";
  const result = transitions.transition("interior", {
    trigger: "portal-proximity-after-walk"
  });
  if (!result.ok) {
    interiorMounting = false;
    return null;
  }
  setPhase("loading-interior", "正在载入内景地形");
  finalIntegrationHost.dataset.mounting = "true";
  finalIntegrationHost.hidden = false;
  let integration = null;
  try {
    integration = mountPhaserInterior(finalIntegrationHost, {
      ariaLabel: "Moreyield 的世界 · 内景",
      onSound: playSound,
      onExit: (detail) => { void returnToExterior(detail); },
      onFailure: () => { statusText.textContent = "内景加载失败，已回退到外景"; }
    });
    finalIntegration = integration;
    await integration.ready;
    if (finalIntegration !== integration) return null;
    delete finalIntegrationHost.dataset.mounting;
    await delay(reducedMotion.matches ? 80 : 380);
    if (finalIntegration !== integration) return null;
    scene.hidden = true;
    setPhase("interior", "内景已载入");
  } catch (error) {
    if (finalIntegration !== integration) return null;
    transitions.reset("exterior");
    finalIntegration?.destroy();
    finalIntegration = null;
    finalIntegrationHost.hidden = true;
    delete finalIntegrationHost.dataset.mounting;
    scene.hidden = false;
    retryTarget = "interior";
    enterLabel.textContent = "重试进入内景";
    setPhase("error", "内景加载失败，已回退到外景，可重试");
    enterButton.focus({ preventScroll: true });
    return null;
  } finally {
    interiorMounting = false;
  }
  return finalIntegration;
}

function imageReady(image) {
  if (image.complete && image.naturalWidth > 0) {
    return image.decode?.().catch(() => undefined) ?? Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", reject, { once: true });
  });
}

async function initialize() {
  setPhase("loading", "场景加载中");
  enterLabel.textContent = "开始探索";
  layoutScene();
  const walker = createExteriorWalker();

  try {
    await Promise.all([
      imageReady(background),
      imageReady(mountainTitle),
      imageReady(playerSprite),
      walker.ready
    ]);
    layoutScene();
    exteriorWalker?.setState("idle");
    player.dataset.visible = "true";
    player.dataset.awake = "false";
    setPhase("idle", "选择开始探索");
  } catch (error) {
    retryTarget = "exterior";
    enterLabel.textContent = "重试加载";
    setPhase("error", "外景素材加载失败，可重试");
  }
}

enterButton.addEventListener("click", () => {
  if (phase === "error" && retryTarget === "interior") void mountInterior();
  else if (phase === "error") void initialize();
  else void activate();
});
skipButton.addEventListener("click", () => {
  skipRequested = true;
  journeyLabel.textContent = "跃迁中";
  statusText.textContent = "已跳过进入动画，正在载入内景";
  skipButton.hidden = true;
});
replayButton.addEventListener("click", (event) => {
  event.stopPropagation();
  replay();
});

window.addEventListener("keydown", (event) => {
  if (event.repeat || event.metaKey || event.ctrlKey || event.altKey) return;
  if (phase === "idle" && ["Enter", " "].includes(event.key) && !isInteractiveTarget(event.target)) {
    event.preventDefault();
    void activate();
  } else if (["complete", "interior"].includes(phase) && ["r", "R"].includes(event.key) && !isInteractiveTarget(event.target)) {
    event.preventDefault();
    replay();
  }
});

window.addEventListener("resize", layoutScene, { passive: true });
window.addEventListener("orientationchange", () => window.setTimeout(layoutScene, 120), { passive: true });
window.addEventListener("yunxing:exterior-complete", () => {
  completionEventCount += 1;
  experience.dataset.completionEvents = String(completionEventCount);
  if (transitions.getState().scene === "exterior") void mountInterior();
});

window.__portalDemo = {
  activate,
  get soundState() {
    return soundEffects.getSnapshot();
  },
  get completionEventCount() {
    return completionEventCount;
  },
  get completedRunId() {
    return completedRunId;
  },
  get phase() {
    return phase;
  },
  get runId() {
    return runId;
  },
  get sceneMetrics() {
    return { ...sceneMetrics };
  },
  get exteriorGroundProfile() {
    return EXTERIOR_GROUND_PROFILE.map((point) => ({ ...point }));
  },
  surfaceYAt,
  get finalIntegrationMounted() {
    return Boolean(finalIntegration);
  },
  get finalIntegration() {
    return finalIntegration;
  },
  mountInterior,
  showExteriorReturn,
  returnToExterior,
  get transitionState() {
    return transitions.getState();
  },
  replay,
  reset
};

initialize();
