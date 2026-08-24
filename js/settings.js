/**
 * Jynx Web Settings & Audio Synthesizer
 * Handles persistent configuration, sound effects, and runtime preferences.
 */
class JynxSettings {
  constructor() {
    this.storageKey = "jynx-web-settings";
    this.defaults = {
      relayAddress: "relay.getjynx.dev:9009",
      relayPassword: "pass123",
      cipher: "AES-256-GCM",
      chunkSizeKb: 256,
      autoAccept: false,
      soundEnabled: true,
      localDiscovery: true,
      theme: "dark"
    };

    this.settings = this.loadSettings();
    this.audioCtx = null;
  }

  loadSettings() {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        return { ...this.defaults, ...JSON.parse(stored) };
      }
    } catch (e) {
      console.warn("Could not load Jynx settings from localStorage", e);
    }
    return { ...this.defaults };
  }

  saveSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    try {
      localStorage.setItem(this.storageKey, JSON.stringify(this.settings));
    } catch (e) {
      console.warn("Could not save Jynx settings", e);
    }
  }

  get(key) {
    return this.settings[key] ?? this.defaults[key];
  }

  set(key, value) {
    this.settings[key] = value;
    this.saveSettings(this.settings);
  }

  // Synthesizes retro terminal audio effects using Web Audio API
  _initAudio() {
    if (!this.audioCtx && typeof AudioContext !== "undefined") {
      const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioCtxClass();
    }
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      this.audioCtx.resume();
    }
  }

  playSound(type) {
    if (!this.get("soundEnabled")) return;
    try {
      this._initAudio();
      if (!this.audioCtx) return;

      const now = this.audioCtx.currentTime;
      const osc = this.audioCtx.createOscillator();
      const gain = this.audioCtx.createGain();

      osc.connect(gain);
      gain.connect(this.audioCtx.destination);

      if (type === "click") {
        // High frequency short terminal tick
        osc.type = "sine";
        osc.frequency.setValueAtTime(1200, now);
        osc.frequency.exponentialRampToValueAtTime(400, now + 0.03);
        gain.gain.setValueAtTime(0.08, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.03);
        osc.start(now);
        osc.stop(now + 0.03);
      } else if (type === "connect") {
        // Double electronic chirp
        osc.type = "triangle";
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.setValueAtTime(900, now + 0.05);
        gain.gain.setValueAtTime(0.1, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.12);
        osc.start(now);
        osc.stop(now + 0.12);
      } else if (type === "success") {
        // Upbeat harmonic completion chime
        osc.type = "sine";
        osc.frequency.setValueAtTime(523.25, now); // C5
        osc.frequency.setValueAtTime(659.25, now + 0.08); // E5
        osc.frequency.setValueAtTime(783.99, now + 0.16); // G5
        osc.frequency.setValueAtTime(1046.50, now + 0.24); // C6
        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.5);
        osc.start(now);
        osc.stop(now + 0.5);
      } else if (type === "error") {
        // Low glitch tone
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(220, now);
        osc.frequency.linearRampToValueAtTime(110, now + 0.18);
        gain.gain.setValueAtTime(0.15, now);
        gain.gain.linearRampToValueAtTime(0.001, now + 0.18);
        osc.start(now);
        osc.stop(now + 0.18);
      }
    } catch (e) {
      // Audio might be blocked by browser policy until user gesture
    }
  }
}

window.jynxSettings = new JynxSettings();
