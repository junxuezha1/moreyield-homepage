// Quiet, short game cues. The caller supplies footsteps from actual movement;
// this module never starts a timer or creates audio before a user gesture.
const MASTER_VOLUME = 0.46;
const MAX_VOICES = 5;
const COOLDOWNS = { step: 95, jump: 220, land: 160, interact: 120 };

export function createSoundEffects() {
  let context = null;
  let master = null;
  let noiseBuffer = null;
  let unavailable = false;
  let destroyed = false;
  let enabled = true;
  let unlocking = null;
  let pendingInteractionUntil = 0;
  let stepIndex = 0;
  const voices = new Set();
  const counts = { step: 0, jump: 0, land: 0, interact: 0 };
  const lastPlayed = { step: -Infinity, jump: -Infinity, land: -Infinity, interact: -Infinity };
  const page = typeof document === "undefined" ? null : document;
  const isVisible = () => !page || page.visibilityState !== "hidden";

  function stopVoice(voice) {
    if (!voices.has(voice)) return;
    voices.delete(voice);
    for (const source of voice.sources) {
      source.onended = null;
      try { source.stop(); } catch { /* Already ended. */ }
    }
    for (const node of voice.nodes) {
      try { node.disconnect(); } catch { /* Already disconnected. */ }
    }
  }

  function stopAll() {
    for (const voice of voices) stopVoice(voice);
  }

  function suspend() {
    pendingInteractionUntil = 0;
    stopAll();
    if (context?.state === "running") {
      try { Promise.resolve(context.suspend()).catch(() => {}); } catch { /* Optional audio. */ }
    }
  }

  function createContext() {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) {
      unavailable = true;
      return false;
    }
    try {
      context = new AudioContextClass({ latencyHint: "interactive" });
      master = context.createGain();
      master.gain.value = enabled ? MASTER_VOLUME : 0;
      master.connect(context.destination);
      noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * 0.3), context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let index = 0; index < samples.length; index += 1) samples[index] = Math.random() * 2 - 1;
      return true;
    } catch {
      unavailable = true;
      try { master?.disconnect(); } catch { /* Optional audio. */ }
      try { Promise.resolve(context?.close()).catch(() => {}); } catch { /* Optional audio. */ }
      context = null;
      master = null;
      return false;
    }
  }

  // Call synchronously from a genuine pointer/keyboard gesture, before awaiting
  // other work. The return value is safe to ignore and never rejects.
  function unlock() {
    if (destroyed || unavailable || !enabled || !isVisible()) return Promise.resolve(false);
    if (unlocking) return unlocking;
    if (!context && !createContext()) return Promise.resolve(false);
    try {
      const resume = context.state === "running" ? Promise.resolve() : context.resume();
      unlocking = Promise.resolve(resume).then(() => {
        if (destroyed || !enabled || !isVisible()) {
          suspend();
          return false;
        }
        const running = context?.state === "running";
        const playInteraction = running && pendingInteractionUntil >= Date.now();
        pendingInteractionUntil = 0;
        if (playInteraction) play("interact");
        return running;
      }).catch(() => {
        pendingInteractionUntil = 0;
        return false;
      }).finally(() => { unlocking = null; });
      return unlocking;
    } catch {
      return Promise.resolve(false);
    }
  }

  function setEnabled(value) {
    enabled = Boolean(value);
    if (master && context?.state !== "closed") {
      try {
        master.gain.cancelScheduledValues(context.currentTime);
        master.gain.setValueAtTime(enabled ? MASTER_VOLUME : 0, context.currentTime);
      } catch { /* The browser may have closed the audio device. */ }
    }
    if (!enabled) suspend();
  }

  function makeEnvelope(voice, time, duration, volume, attack = 0.007) {
    const gain = context.createGain();
    voice.nodes.push(gain);
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(volume, time + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    gain.gain.setValueAtTime(0, time + duration + 0.005);
    gain.connect(master);
    return gain;
  }

  function startSource(voice, source, time, duration) {
    voice.sources.push(source);
    source.onended = () => {
      voice.ended += 1;
      if (voice.ended === voice.sources.length) stopVoice(voice);
    };
    source.start(time);
    source.stop(time + duration + 0.01);
  }

  function tone(voice, time, duration, from, to, volume, type = "sine") {
    const oscillator = context.createOscillator();
    voice.nodes.push(oscillator);
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, time);
    oscillator.frequency.exponentialRampToValueAtTime(to, time + duration);
    oscillator.connect(makeEnvelope(voice, time, duration, volume));
    startSource(voice, oscillator, time, duration);
  }

  function rustle(voice, time, duration, volume, frequency, playbackRate = 1) {
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    voice.nodes.push(source, filter);
    source.buffer = noiseBuffer;
    source.playbackRate.value = playbackRate;
    filter.type = "bandpass";
    filter.frequency.value = frequency;
    filter.Q.value = 0.65;
    source.connect(filter);
    filter.connect(makeEnvelope(voice, time, duration, volume));
    startSource(voice, source, time, duration);
  }

  function play(type) {
    // On the first gesture, resume() may still be pending. Keep just one fresh
    // confirmation cue; movement is never queued or replayed after a pause.
    if (type === "interact" && unlocking && !destroyed && enabled && isVisible() && context?.state !== "running") {
      if (!pendingInteractionUntil) pendingInteractionUntil = Date.now() + 250;
      return false;
    }
    if (destroyed || !enabled || !isVisible() || context?.state !== "running" || !master) return false;
    const now = context.currentTime;
    const milliseconds = now * 1000;
    if (milliseconds - lastPlayed[type] < COOLDOWNS[type]) return false;
    // A takeoff/landing owns the movement cue briefly; avoid a doubled footfall.
    if (type === "step" && (milliseconds - lastPlayed.jump < 180 || milliseconds - lastPlayed.land < 110)) return false;
    if (type === "jump" || type === "land") {
      for (const voice of voices) if (voice.type === "step") stopVoice(voice);
    }
    if (voices.size >= MAX_VOICES) {
      if (type === "step") return false;
      stopVoice(voices.values().next().value);
    }
    const voice = { type, nodes: [], sources: [], ended: 0 };
    voices.add(voice);
    try {
      const time = now + 0.004;
      if (type === "step") {
        const alternate = stepIndex % 2;
        rustle(voice, time, 0.085, 0.095, alternate ? 760 : 620, alternate ? 1.07 : 0.96);
        tone(voice, time, 0.065, alternate ? 132 : 116, 78, 0.068);
        stepIndex += 1;
      } else if (type === "jump") {
        tone(voice, time, 0.16, 225, 510, 0.065, "triangle");
        rustle(voice, time, 0.055, 0.032, 920);
      } else if (type === "land") {
        tone(voice, time, 0.095, 122, 58, 0.095);
        rustle(voice, time, 0.12, 0.105, 500, 0.9);
      } else {
        tone(voice, time, 0.075, 440, 440, 0.044, "triangle");
        tone(voice, time + 0.05, 0.1, 660, 660, 0.037, "triangle");
      }
      lastPlayed[type] = milliseconds;
      counts[type] += 1;
      return true;
    } catch {
      stopVoice(voice);
      return false;
    }
  }

  const onVisibilityChange = () => { if (!isVisible()) suspend(); };
  page?.addEventListener("visibilitychange", onVisibilityChange);

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    pendingInteractionUntil = 0;
    stopAll();
    page?.removeEventListener("visibilitychange", onVisibilityChange);
    try { master?.disconnect(); } catch { /* Already disconnected. */ }
    if (context && context.state !== "closed") {
      try { Promise.resolve(context.close()).catch(() => {}); } catch { /* Optional audio. */ }
    }
    noiseBuffer = null;
  }

  return {
    unlock,
    setEnabled,
    step: () => play("step"),
    jump: () => play("jump"),
    land: () => play("land"),
    interact: () => play("interact"),
    destroy,
    getSnapshot: () => ({
      enabled,
      contextState: destroyed ? "closed" : unavailable ? "unavailable" : context?.state || "uninitialized",
      counts: { ...counts },
      activeVoices: voices.size
    })
  };
}
