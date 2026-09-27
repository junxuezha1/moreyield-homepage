import { getActorMotionProfile, getMotionClip, normalizeMotionState } from "./character-motion-profile.js";

const TRANSPARENT_PIXEL =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
const imageCache = new Map();

function preload(file) {
  if (!file) return Promise.resolve(null);
  if (!imageCache.has(file)) {
    imageCache.set(
      file,
      new Promise((resolve, reject) => {
        const image = new Image();
        image.decoding = "async";
        image.onload = () => image.decode().then(() => resolve(file), reject);
        image.onerror = () => reject(new Error(`Actor atlas failed: ${file}`));
        image.src = file;
      })
    );
  }
  return imageCache.get(file);
}

function uniqueAvailableFrames(actorProfile) {
  return Object.values(actorProfile.atlases);
}

function cssPixels(value) {
  return `${Math.round(value)}px`;
}

export function createCharacterWalker({ element, actor = "npc", initialState = "idle" }) {
  if (!(element instanceof HTMLImageElement)) {
    throw new TypeError("createCharacterWalker expects an HTMLImageElement");
  }

  const actorProfile = getActorMotionProfile(actor);
  let state = normalizeMotionState(initialState);
  let frameIndex = 0;
  let elapsed = 0;
  let speed = 1;
  let paused = false;
  let destroyed = false;
  let previousTime = 0;
  let rafId = 0;
  let readyResolved = false;

  element.classList.add("character-walk-v3");
  element.src = TRANSPARENT_PIXEL;
  element.draggable = false;
  element.alt ||= actor === "player" ? "白衣主控动作" : "黑衣 NPC 动作";
  element.style.aspectRatio = `${actorProfile.frameSize.width} / ${actorProfile.frameSize.height}`;
  element.style.setProperty("--actor-frame-width", cssPixels(actorProfile.frameSize.width));
  element.style.setProperty("--actor-frame-height", cssPixels(actorProfile.frameSize.height));
  element.style.setProperty("--actor-foot-x", cssPixels(actorProfile.footAnchor.x));
  element.style.setProperty("--actor-foot-y", cssPixels(actorProfile.footAnchor.y));
  element.style.setProperty("--actor-scale", String(actorProfile.scale));

  function clip() {
    return getMotionClip(actor, state);
  }

  function currentFrame() {
    const current = clip();
    if (!current.available || current.frames.length === 0) return null;
    return current.frames[Math.min(frameIndex, current.frames.length - 1)];
  }

  function render() {
    if (destroyed || !readyResolved) return;
    const current = clip();
    const frame = currentFrame();
    const direction = current.direction || "right";
    const atlasIndex = Math.max(0, actorProfile.directions[direction].frames.indexOf(frame));
    element.style.backgroundImage = `url("${actorProfile.atlases[direction]}")`;
    element.style.backgroundSize = "400% 100%";
    element.style.backgroundPosition = `${atlasIndex * 100 / 3}% 0`;
    element.style.backgroundRepeat = "no-repeat";
    element.dataset.actor = actor;
    element.dataset.direction = current.direction || "right";
    element.dataset.state = state;
    element.dataset.motionType = current.type;
    element.dataset.available = String(Boolean(current.available));
    element.dataset.frame = frame ? String(frameIndex + 1) : "0";
    element.dataset.frameCount = String(current.frames?.length || 0);
    element.dataset.src = frame || "";
    element.dataset.label = current.label || "";
    element.dataset.missingReason = current.reason || "";
    element.style.transform = "translate3d(0, 0, 0)";
  }

  function setStateInternal(nextState, { restart = true } = {}) {
    const normalized = normalizeMotionState(nextState);
    if (!actorProfile.states[normalized]) throw new RangeError(`Unknown actor state: ${nextState}`);
    state = normalized;
    if (restart) {
      frameIndex = 0;
      elapsed = 0;
    }
    if (!clip().available || clip().fps === 0) paused = true;
    render();
  }

  function advance(by = 1) {
    const current = clip();
    if (!current.available || current.frames.length === 0) {
      render();
      return;
    }
    frameIndex = (frameIndex + by + current.frames.length) % current.frames.length;
    elapsed = 0;
    render();
  }

  function tick(time) {
    if (destroyed) return;
    if (!previousTime) previousTime = time;
    const delta = Math.min(time - previousTime, 80);
    previousTime = time;
    const current = clip();
    if (!paused && readyResolved && current.available && current.frames.length > 1 && current.fps > 0) {
      elapsed += delta * speed;
      const frameDuration = 1000 / current.fps;
      while (elapsed >= frameDuration) {
        elapsed -= frameDuration;
        frameIndex = (frameIndex + 1) % current.frames.length;
        render();
      }
    }
    rafId = requestAnimationFrame(tick);
  }

  const ready = Promise.all(uniqueAvailableFrames(actorProfile).map(preload)).then(() => {
    if (destroyed) return;
    readyResolved = true;
    setStateInternal(state, { restart: true });
  });

  rafId = requestAnimationFrame(tick);

  const api = {
    ready,
    play() {
      if (clip().available) paused = false;
      return api;
    },
    pause() {
      paused = true;
      return api;
    },
    setPaused(nextPaused) {
      paused = Boolean(nextPaused);
      if (!clip().available) paused = true;
      return api;
    },
    setSpeed(nextSpeed) {
      const value = Number(nextSpeed);
      if (!Number.isFinite(value) || value < 0) throw new RangeError("Speed must be a non-negative number");
      speed = value;
      return api;
    },
    setState(nextState) {
      setStateInternal(nextState);
      if (clip().available && clip().frames.length > 1) paused = false;
      return api;
    },
    setDirection(nextDirection) {
      if (nextDirection !== "left" && nextDirection !== "right") {
        throw new RangeError('Direction must be "left" or "right"');
      }
      return api.setState(`walk-${nextDirection}`);
    },
    step(by = 1) {
      const value = Number(by);
      const delta = Number.isFinite(value) && value < 0 ? -1 : 1;
      paused = true;
      if (!readyResolved) {
        return ready.then(() => {
          advance(delta);
          return api;
        });
      }
      advance(delta);
      return api;
    },
    snapshot() {
      const current = clip();
      const frame = currentFrame();
      return {
        actor,
        state,
        direction: current.direction || "right",
        frame: frame ? frameIndex + 1 : 0,
        frameCount: current.frames?.length || 0,
        src: frame,
        available: Boolean(current.available),
        footAnchor: actorProfile.footAnchor,
        frameSize: actorProfile.frameSize,
        label: current.label,
        missingReason: current.reason
      };
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(rafId);
      element.classList.remove("character-walk-v3");
      element.removeAttribute("style");
      for (const key of [
        "actor",
        "direction",
        "state",
        "motionType",
        "available",
        "frame",
        "frameCount",
        "src",
        "label",
        "missingReason"
      ]) {
        delete element.dataset[key];
      }
    }
  };

  return api;
}
