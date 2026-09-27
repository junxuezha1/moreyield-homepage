const DEFAULT_BOUNDS = Object.freeze({ left: 0.31, right: 0.69 });
const STATE = Object.freeze({
  IDLE: "idle",
  WALK_LEFT: "walk-left",
  WALK_RIGHT: "walk-right",
  THINKING: "thinking",
  INTERACTING: "interacting"
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeBounds(bounds) {
  const left = finite(bounds?.left, DEFAULT_BOUNDS.left);
  const right = finite(bounds?.right, DEFAULT_BOUNDS.right);

  if (left >= right) {
    throw new RangeError("bounds.left must be less than bounds.right.");
  }

  return Object.freeze({ left, right });
}

function chooseWeighted(random, choices) {
  const total = choices.reduce((sum, choice) => sum + choice.weight, 0);
  let cursor = random() * total;

  for (const choice of choices) {
    cursor -= choice.weight;
    if (cursor <= 0) return choice.value;
  }

  return choices.at(-1).value;
}

export function createNpcBehavior({
  getPosition,
  setPosition: writePosition,
  bounds,
  groundY = 0.76,
  speedRange,
  patrolStops,
  autoUpdate = true,
  rng = Math.random,
  onStateChange,
  onPositionChange
} = {}) {
  if (getPosition !== undefined && typeof getPosition !== "function") {
    throw new TypeError("getPosition must be a function.");
  }
  if (writePosition !== undefined && typeof writePosition !== "function") {
    throw new TypeError("setPosition must be a function.");
  }
  if (typeof rng !== "function") throw new TypeError("rng must be a function.");
  if (onStateChange !== undefined && typeof onStateChange !== "function") {
    throw new TypeError("onStateChange must be a function.");
  }
  if (onPositionChange !== undefined && typeof onPositionChange !== "function") {
    throw new TypeError("onPositionChange must be a function.");
  }

  const limits = normalizeBounds(bounds);
  if (patrolStops !== undefined && (!Array.isArray(patrolStops) || patrolStops.some((stop) => !Number.isFinite(stop)))) {
    throw new TypeError("patrolStops must be an array of finite numbers.");
  }
  const stops = [...new Set((patrolStops || []).map((stop) => clamp(stop, limits.left, limits.right)))].sort((a, b) => a - b);
  const roaming = stops.length > 0;
  const speeds = Object.freeze({
    min: finite(speedRange?.min, 58),
    max: finite(speedRange?.max, 116)
  });
  if (speeds.min < 0 || speeds.min > speeds.max) throw new RangeError("speedRange must be non-negative and ordered.");
  const groundAt = (nextX) => finite(typeof groundY === "function" ? groundY(nextX) : groundY, 0.76);
  const initial = getPosition?.() || {};

  let x = clamp(finite(initial.x, (limits.left + limits.right) / 2), limits.left, limits.right);
  let y = groundAt(x);
  let state = STATE.IDLE;
  let facing = "right";
  let remainingMs = 0;
  let lastTimestamp = null;
  let rafId = null;
  let running = false;
  let destroyed = false;
  let interacting = false;
  let playerNear = false;
  let pendingDirection = null;
  let previousAutonomousState = STATE.IDLE;
  let walkSpeed = speeds.min;
  let targetX = null;
  let destinationType = null;
  let patrolStopX = null;
  let queuedTourStop = null;
  let tourBag = [];
  let completedStops = 0;
  let completedTours = 0;
  let proximityCooldownMs = 0;
  let turnReady = false;

  function randomBetween(min, max) {
    return min + clamp(finite(rng(), 0.5), 0, 0.999999999) * (max - min);
  }

  function snapshot() {
    return Object.freeze({
      state,
      x,
      y,
      remaining: Math.max(0, remainingMs) / 1000,
      running,
      destroyed,
      playerNear,
      interacting,
      facing,
      bounds: limits,
      speed: walkSpeed,
      routeMode: roaming ? "roaming" : "wander",
      targetX,
      destinationType,
      patrolStopX,
      completedStops,
      completedTours
    });
  }

  function emitPosition() {
    const point = Object.freeze({ x, y });
    writePosition?.(x, y);
    onPositionChange?.(point);
  }

  function enter(nextState, durationSeconds) {
    const changed = state !== nextState;
    state = nextState;
    remainingMs = Math.max(0, durationSeconds * 1000);

    if (nextState === STATE.WALK_LEFT) facing = "left";
    if (nextState === STATE.WALK_RIGHT) facing = "right";
    if (nextState !== STATE.INTERACTING) previousAutonomousState = nextState;
    if (changed) onStateChange?.(nextState);
  }

  function pauseBeforeTurn(direction) {
    pendingDirection = direction;
    enter(STATE.IDLE, randomBetween(0.32, 0.68));
  }

  function refillTour() {
    tourBag = stops.slice();
    for (let index = tourBag.length - 1; index > 0; index -= 1) {
      const other = Math.floor(randomBetween(0, index + 1));
      [tourBag[index], tourBag[other]] = [tourBag[other], tourBag[index]];
    }
  }

  function setDestination(stop, type) {
    patrolStopX = type === "tour" ? stop : null;
    const neighborDistance = stops.reduce((distance, candidate) => candidate === stop ? distance : Math.min(distance, Math.abs(candidate - stop)), limits.right - limits.left);
    const jitter = type === "tour" ? Math.min(36, neighborDistance * 0.15) : 0;
    targetX = clamp(stop + randomBetween(-jitter, jitter), limits.left, limits.right);
    destinationType = type;
    walkSpeed = randomBetween(speeds.min, speeds.max);
    turnReady = false;
  }

  function chooseRoamingNext() {
    if (targetX === null) {
      if (queuedTourStop !== null) {
        setDestination(queuedTourStop, "tour");
        queuedTourStop = null;
      } else {
        if (tourBag.length === 0) refillTour();
        const nextStop = tourBag.pop();
        const span = limits.right - limits.left;
        const detourDistance = randomBetween(span * 0.025, Math.min(240, span * 0.09));
        const direction = randomBetween(0, 1) < 0.5 ? -1 : 1;
        const detourX = clamp(x + direction * detourDistance, limits.left, limits.right);
        // At most one local detour precedes each tour stop, so every zone remains reachable.
        if (randomBetween(0, 1) < 0.36 && Math.abs(nextStop - x) > span * 0.08 && Math.abs(detourX - x) > span * 0.012) {
          queuedTourStop = nextStop;
          setDestination(detourX, "detour");
        } else {
          setDestination(nextStop, "tour");
        }
      }
    }

    const direction = targetX < x ? "left" : "right";
    if (direction !== facing && !turnReady) {
      turnReady = true;
      enter(STATE.IDLE, randomBetween(0.18, 0.48));
      return;
    }
    enter(direction === "left" ? STATE.WALK_LEFT : STATE.WALK_RIGHT, 0);
  }

  function arrive() {
    if (destinationType === "tour") {
      completedStops += 1;
      if (completedStops % stops.length === 0) completedTours += 1;
    }
    targetX = null;
    destinationType = null;
    patrolStopX = null;
    turnReady = false;
    const thinking = randomBetween(0, 1) < 0.3;
    const dwell = thinking ? randomBetween(1.4, 3.8) : randomBetween(0.5, 2.1);
    enter(thinking ? STATE.THINKING : STATE.IDLE, dwell + (playerNear ? randomBetween(0.3, 0.9) : 0));
  }

  function updateRoamingWalking(deltaSeconds) {
    if (targetX === null) return;
    const distance = Math.abs(targetX - x);
    const slowZone = Math.min(48, (limits.right - limits.left) * 0.025);
    const step = Math.min(distance, walkSpeed * clamp(distance / slowZone, 0.35, 1) * deltaSeconds);
    if (step > 0) {
      x = step === distance ? targetX : x + Math.sign(targetX - x) * step;
      y = groundAt(x);
      emitPosition();
    }
    if (x === targetX) arrive();
  }

  function chooseNext() {
    if (pendingDirection) {
      const direction = pendingDirection;
      pendingDirection = null;
      walkSpeed = randomBetween(speeds.min, speeds.max);
      enter(direction === "left" ? STATE.WALK_LEFT : STATE.WALK_RIGHT, randomBetween(2, 6));
      return;
    }

    const center = (limits.left + limits.right) / 2;
    const edgeSpan = (limits.right - limits.left) * 0.2;
    const nearLeft = x - limits.left < edgeSpan;
    const nearRight = limits.right - x < edgeSpan;
    const repeatedWalk = state === STATE.WALK_LEFT || state === STATE.WALK_RIGHT;
    let choices;

    if (nearLeft) {
      choices = [
        { value: STATE.WALK_RIGHT, weight: 7 },
        { value: STATE.IDLE, weight: 2.5 },
        { value: STATE.THINKING, weight: 2 }
      ];
    } else if (nearRight) {
      choices = [
        { value: STATE.WALK_LEFT, weight: 7 },
        { value: STATE.IDLE, weight: 2.5 },
        { value: STATE.THINKING, weight: 2 }
      ];
    } else {
      const movementWeight = playerNear ? 1.3 : 3.2;
      const repeatPenalty = repeatedWalk ? 0.52 : 1;
      const inward = x <= center ? STATE.WALK_RIGHT : STATE.WALK_LEFT;
      const outward = inward === STATE.WALK_LEFT ? STATE.WALK_RIGHT : STATE.WALK_LEFT;
      choices = [
        { value: inward, weight: movementWeight * (playerNear ? 1.8 : 1) * repeatPenalty },
        { value: outward, weight: movementWeight * (playerNear ? 0.35 : 1) * repeatPenalty },
        { value: STATE.IDLE, weight: playerNear ? 4.6 : 2.8 },
        { value: STATE.THINKING, weight: playerNear ? 3.8 : 2.2 }
      ];
    }

    // A repeated semantic state would make two bounded durations look like one
    // unbounded action in the integrating scene.
    const alternatives = choices.filter((choice) => choice.value !== state);
    const next = chooseWeighted(rng, alternatives.length ? alternatives : choices);

    if (
      (state === STATE.WALK_LEFT && next === STATE.WALK_RIGHT) ||
      (state === STATE.WALK_RIGHT && next === STATE.WALK_LEFT)
    ) {
      pauseBeforeTurn(next === STATE.WALK_LEFT ? "left" : "right");
      return;
    }

    if (next === STATE.IDLE) enter(next, randomBetween(1.5, 4));
    else if (next === STATE.THINKING) enter(next, randomBetween(2.5, 6));
    else {
      walkSpeed = randomBetween(speeds.min, speeds.max);
      enter(next, randomBetween(2, 6));
    }
  }

  function updateWalking(deltaSeconds) {
    const direction = state === STATE.WALK_LEFT ? -1 : 1;
    const distanceToEdge = direction < 0 ? x - limits.left : limits.right - x;
    const slowZone = Math.min(220, (limits.right - limits.left) * 0.18);
    const speedScale = clamp(distanceToEdge / slowZone, 0.16, 1);
    const nextX = clamp(x + direction * walkSpeed * speedScale * deltaSeconds, limits.left, limits.right);

    if (nextX !== x) {
      x = nextX;
      y = groundAt(x);
      emitPosition();
    }

    if (distanceToEdge <= 8) {
      x = direction < 0 ? limits.left : limits.right;
      y = groundAt(x);
      emitPosition();
      pauseBeforeTurn(direction < 0 ? "right" : "left");
    }
  }

  function update(deltaMs) {
    if (!running || destroyed || interacting) return snapshot();
    const elapsedMs = clamp(finite(deltaMs, 0), 0, 100);
    proximityCooldownMs = Math.max(0, proximityCooldownMs - elapsedMs);
    const walking = state === STATE.WALK_LEFT || state === STATE.WALK_RIGHT;

    if (roaming) {
      if (walking) updateRoamingWalking(elapsedMs / 1000);
      else {
        remainingMs -= elapsedMs;
        if (remainingMs <= 0) chooseRoamingNext();
      }
    } else {
      remainingMs -= elapsedMs;
      if (walking) updateWalking(elapsedMs / 1000);
      if (running && !destroyed && !interacting && remainingMs <= 0) chooseNext();
    }
    return snapshot();
  }

  function tick(timestamp) {
    if (!running || destroyed || interacting) {
      rafId = null;
      lastTimestamp = null;
      return;
    }

    const deltaMs = lastTimestamp === null ? 0 : Math.min(100, timestamp - lastTimestamp);
    lastTimestamp = timestamp;
    update(deltaMs);

    if (!running || destroyed || interacting) {
      rafId = null;
      lastTimestamp = null;
      return;
    }
    if (running && !destroyed && !interacting) rafId = requestAnimationFrame(tick);
  }

  function start() {
    if (destroyed || running) return snapshot();
    running = true;
    lastTimestamp = null;
    if (!interacting && remainingMs <= 0) enter(STATE.IDLE, randomBetween(1.5, 4));
    if (!interacting && autoUpdate) rafId = requestAnimationFrame(tick);
    return snapshot();
  }

  function stop() {
    running = false;
    lastTimestamp = null;
    if (rafId !== null) cancelAnimationFrame(rafId);
    rafId = null;
    return snapshot();
  }

  function setInteracting(value) {
    if (destroyed) return snapshot();
    const next = Boolean(value);
    if (next === interacting) return snapshot();
    interacting = next;

    if (interacting) {
      if (state !== STATE.INTERACTING) previousAutonomousState = state;
      if (rafId !== null) cancelAnimationFrame(rafId);
      rafId = null;
      lastTimestamp = null;
      pendingDirection = null;
      enter(STATE.INTERACTING, 0);
    } else {
      enter(STATE.IDLE, randomBetween(0.45, 0.9));
      if (running && autoUpdate && rafId === null) rafId = requestAnimationFrame(tick);
    }

    return snapshot();
  }

  function setPlayerNear(value) {
    if (destroyed) return snapshot();
    const approaching = Boolean(value) && !playerNear;
    playerNear = Boolean(value);
    if (roaming && approaching && !interacting && proximityCooldownMs <= 0) {
      proximityCooldownMs = 8000;
      enter(STATE.IDLE, randomBetween(0.6, 1.1));
    }
    return snapshot();
  }

  function moveTo(nextX) {
    if (destroyed) return snapshot();
    const clamped = clamp(finite(nextX, x), limits.left, limits.right);
    if (clamped !== x) {
      x = clamped;
      y = groundAt(x);
      emitPosition();
    }
    return snapshot();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    stop();
    interacting = false;
    pendingDirection = null;
    targetX = null;
    destinationType = null;
    patrolStopX = null;
  }

  emitPosition();

  return Object.freeze({
    start,
    stop,
    update,
    setInteracting,
    setPlayerNear,
    setPosition: moveTo,
    getState: snapshot,
    destroy
  });
}
