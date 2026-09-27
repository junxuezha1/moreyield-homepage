const PREFERENCE_KEY = "moreyield-world-music";
const MUSIC_VOLUME = 0.22;

export function createBackgroundMusic({ audio, button, onEnabledChange }) {
  let enabled = true;
  let started = false;
  let pendingPlay = false;
  let unavailable = false;
  let fadeFrame = 0;
  let playAttempt = 0;
  const listeners = new AbortController();

  try { enabled = localStorage.getItem(PREFERENCE_KEY) !== "off"; } catch { /* Storage is optional. */ }
  onEnabledChange?.(enabled);
  audio.volume = MUSIC_VOLUME;
  audio.loop = true;

  const render = () => {
    const playing = !audio.paused && enabled && !document.hidden;
    const label = pendingPlay ? "正在加载音乐，点击关闭声音"
      : playing ? "关闭声音"
        : unavailable ? "重试播放音乐" : "开启声音";
    button.dataset.state = playing ? "playing" : pendingPlay ? "loading" : "off";
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(playing));
    button.title = `${label} · Terraria — ${audio.dataset.track}`;
  };

  const stop = () => {
    playAttempt += 1;
    cancelAnimationFrame(fadeFrame);
    pendingPlay = false;
    audio.pause();
    render();
  };

  const play = async () => {
    if (!enabled || !started || document.hidden || pendingPlay || !audio.paused) return;
    pendingPlay = true;
    const attempt = ++playAttempt;
    unavailable = false;
    if (audio.error) audio.load();
    audio.volume = 0;
    render();
    try {
      // Called directly from a click/key gesture so mobile browsers allow audio.
      await audio.play();
      if (attempt !== playAttempt) return;
      if (!enabled || document.hidden) { stop(); return; }
      const began = performance.now();
      const fadeIn = (now) => {
        const progress = Math.max(0, Math.min(1, (now - began) / 1000));
        audio.volume = MUSIC_VOLUME * progress;
        if (progress < 1) fadeFrame = requestAnimationFrame(fadeIn);
      };
      fadeFrame = requestAnimationFrame(fadeIn);
    } catch (error) {
      if (attempt === playAttempt) unavailable = error.name !== "AbortError";
    } finally {
      if (attempt === playAttempt) {
        pendingPlay = false;
        render();
      }
    }
  };

  const start = () => { started = true; void play(); };
  button.addEventListener("click", () => {
    if (!audio.paused || pendingPlay) enabled = false;
    else enabled = true;
    onEnabledChange?.(enabled);
    try { localStorage.setItem(PREFERENCE_KEY, enabled ? "on" : "off"); } catch { /* Storage is optional. */ }
    if (enabled) start();
    else stop();
  }, { signal: listeners.signal });
  for (const type of ["keydown", "keyup"]) {
    button.addEventListener(type, (event) => {
      if (event.key !== "Escape") event.stopPropagation();
    }, { signal: listeners.signal });
  }
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else void play();
  }, { signal: listeners.signal });
  window.addEventListener("pagehide", stop, { signal: listeners.signal });
  window.addEventListener("pageshow", () => { void play(); }, { signal: listeners.signal });
  audio.addEventListener("error", () => {
    unavailable = true;
    pendingPlay = false;
    render();
  }, { signal: listeners.signal });
  audio.addEventListener("pause", render, { signal: listeners.signal });
  audio.addEventListener("playing", render, { signal: listeners.signal });
  render();

  return {
    start,
    destroy() {
      listeners.abort();
      stop();
    }
  };
}
