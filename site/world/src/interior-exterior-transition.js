const VALID_SCENES = new Set(["exterior", "interior"]);

export function createSceneTransitionCoordinator({ initialScene = "exterior", onFailure } = {}) {
  if (!VALID_SCENES.has(initialScene)) throw new RangeError(`Unknown initial scene: ${initialScene}`);

  let scene = initialScene;
  let busy = false;
  let transitionId = 0;
  let lastFailure = null;

  function snapshot() {
    return Object.freeze({ scene, busy, transitionId, lastFailure });
  }

  function fail(reason, error = null, notify = false) {
    const failure = { reason, message: error?.message || String(reason) };
    lastFailure = failure;
    busy = false;
    if (notify) {
      try {
        onFailure?.(failure);
      } catch {
        // Failure reporting must not mask the original transition failure.
      }
    }
    return { ok: false, ...failure, state: snapshot() };
  }

  function transition(target, detail = {}) {
    if (!VALID_SCENES.has(target)) return fail("unknown-target");
    if (busy) return fail("busy");
    if (target === scene) return fail("same-scene");

    const from = scene;
    const id = ++transitionId;
    busy = true;
    lastFailure = null;

    try {
      detail.commit?.({ id, from, to: target, detail: { ...detail } });
      scene = target;
      busy = false;
      return { ok: true, id, from, to: target, state: snapshot() };
    } catch (error) {
      scene = from;
      return fail("commit-failed", error, true);
    }
  }

  return Object.freeze({
    getState: snapshot,
    transition,
    fail,
    reset(nextScene = initialScene) {
      if (!VALID_SCENES.has(nextScene) || busy) return false;
      scene = nextScene;
      lastFailure = null;
      return true;
    }
  });
}
