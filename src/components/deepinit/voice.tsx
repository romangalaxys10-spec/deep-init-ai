"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VOICE_PRESETS, useDeepInit } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { AudioLines, Loader2, Mic, MicOff, Radio, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/* ============================================================
 * Compatibility capture — PCM mic → server STT.
 *
 * The browser's SpeechRecognition depends on the vendor's cloud
 * speech servers being reachable from the USER's network — when
 * they are blocked (VPN/region) or the browser doesn't ship the
 * API, voice mode used to just error out. This fallback captures
 * raw mic PCM locally (AudioWorklet, silence-detected), encodes a
 * 16k WAV in the browser and posts it to /api/voice/stt, whose
 * keyless server-side transcription works from every host.
 * ============================================================ */

const WORKLET_SRC = `class PCMCapture extends AudioWorkletProcessor{process(inputs){const c=inputs[0]&&inputs[0][0];if(c)this.port.postMessage(c.slice(0));return true}}registerProcessor("pcm-capture",PCMCapture);`;

const VAD_RMS = 0.014; // speech RMS floor (post noise-suppression)
const VAD_RAMP_MS = 160; // cumulative speech needed to arm the commit
const VAD_SILENCE_MS = 1200; // trailing silence that closes an utterance
const VAD_MAX_MS = 15000; // hard cap per utterance

interface VoiceCaptureResult {
  text?: string;
  error?: string;
  /** Language Mirror — server-detected language of the transcript */
  lang?: string;
}

interface VoiceCapture {
  /** stop capturing; when transcribe=true, encode + POST → transcript */
  stop(transcribe: boolean): Promise<VoiceCaptureResult>;
}

function resampleLocal(samples: Float32Array, srcRate: number, dstRate = 16000): Float32Array {
  if (!samples.length || srcRate === dstRate) return samples;
  const ratio = srcRate / dstRate;
  const n = Math.max(0, Math.floor(samples.length / ratio));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const i0 = Math.floor(p);
    const frac = p - i0;
    const a = samples[i0] ?? 0;
    const b = samples[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function encodeWavLocal(samples: Float32Array, rate = 16000): Uint8Array {
  const buf = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(buf.buffer);
  const wstr = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i));
  };
  wstr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  wstr(8, "WAVE");
  wstr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  wstr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
  }
  return buf;
}

function bufToBase64(bytes: Uint8Array): string {
  let bin = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    bin += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(bin);
}

async function postStt(wav: Uint8Array, lang: string, multiLang = true): Promise<VoiceCaptureResult> {
  try {
    const res = await fetch("/api/voice/stt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: bufToBase64(wav), mime: "audio/wav", lang, multiLang }),
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; lang?: string; error?: string };
    if (res.ok && data.text) return { text: String(data.text), lang: data.lang ?? undefined };
    return { error: String(data.error || "stt-fail") };
  } catch {
    return { error: "stt-network" };
  }
}

/** Open a VAD-driven PCM capture of the microphone. Returns null when
 * the mic is unavailable/denied. onAutoCommit fires once when the
 * utterance ends (trailing silence) or the hard cap is reached. */
async function openVoiceCapture(opts: {
  lang: string;
  /** Language Mirror — server tries several locales until one understands */
  multiLang?: boolean;
  onAutoCommit?: (c: VoiceCapture) => void;
}): Promise<VoiceCapture | null> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return null;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch {
    return null;
  }

  let ctx: AudioContext;
  try {
    ctx = new AudioContext({ sampleRate: 16000 });
  } catch {
    ctx = new AudioContext();
  }
  try {
    await ctx.resume();
  } catch {
    /* autoplay policy — capture still works */
  }
  const src = ctx.createMediaStreamSource(stream);

  const st = { chunks: [] as Float32Array[], total: 0, speechMs: 0, silenceMs: 0, armed: false, done: false, stopped: false };
  let autoFired = false;
  let workletUrl: string | null = null;

  const handleChunk = (chunk: Float32Array) => {
    if (st.done) return;
    st.chunks.push(chunk);
    st.total += chunk.length;
    let sum = 0;
    for (let i = 0; i < chunk.length; i++) sum += chunk[i] * chunk[i];
    const rms = Math.sqrt(sum / Math.max(1, chunk.length));
    const ms = (chunk.length / ctx.sampleRate) * 1000;
    if (rms >= VAD_RMS) {
      st.speechMs += ms;
      st.silenceMs = 0;
      if (st.speechMs >= VAD_RAMP_MS) st.armed = true;
    } else {
      st.silenceMs += ms;
    }
    const capped = st.total >= ctx.sampleRate * (VAD_MAX_MS / 1000);
    if (!autoFired && ((st.armed && st.silenceMs >= VAD_SILENCE_MS) || capped)) {
      autoFired = true;
      opts.onAutoCommit?.(capture);
    }
  };

  let node: AudioWorkletNode | ScriptProcessorNode;
  try {
    workletUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
    await ctx.audioWorklet.addModule(workletUrl);
    const wn = new AudioWorkletNode(ctx, "pcm-capture");
    wn.port.onmessage = (e) => handleChunk(e.data as Float32Array);
    src.connect(wn);
    wn.connect(ctx.destination); // silent output — pumps the graph
    node = wn;
  } catch {
    const sp = ctx.createScriptProcessor(2048, 1, 1);
    sp.onaudioprocess = (e) => handleChunk(new Float32Array(e.inputBuffer.getChannelData(0)));
    src.connect(sp);
    sp.connect(ctx.destination); // silent output — pumps the graph
    node = sp;
  }

  const capture: VoiceCapture = {
    stop: (transcribe: boolean): Promise<VoiceCaptureResult> => {
      if (st.stopped) return Promise.resolve({});
      st.stopped = true;
      st.done = true;
      try {
        node.disconnect();
      } catch {
        /* already disconnected */
      }
      try {
        src.disconnect();
      } catch {
        /* already disconnected */
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => undefined);
      if (workletUrl) URL.revokeObjectURL(workletUrl);
      if (!transcribe) return Promise.resolve({});
      const merged = new Float32Array(st.total);
      let off = 0;
      for (const c of st.chunks) {
        merged.set(c, off);
        off += c.length;
      }
      const samples = resampleLocal(merged, ctx.sampleRate, 16000);
      return postStt(encodeWavLocal(samples, 16000), opts.lang, opts.multiLang !== false);
    },
  };
  return capture;
}

/** Synthesize speech via the edge-tts gateway and play it. */
export function useSpeak() {
  const voice = useDeepInit((s) => s.voice);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  /** fires when the current utterance finishes — naturally OR interrupted */
  const doneRef = useRef<(() => void) | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeakingId(null);
    const done = doneRef.current;
    doneRef.current = null;
    done?.();
  }, []);

  const speak = useCallback(
    async (text: string, id = "manual", onDone?: () => void) => {
      const clean = text
        .replace(/```[\s\S]*?```/g, " code block omitted. ")
        .replace(/[*_#>`~|-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200);
      if (!clean) return false;
      stop();
      doneRef.current = onDone ?? null;
      setSpeakingId(id);
      try {
        const res = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, voice: voice.voice, rate: voice.rate, pitch: voice.pitch }),
        });
        if (!res.ok) {
          setSpeakingId(null);
          const done = doneRef.current;
          doneRef.current = null;
          done?.();
          return false;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          setSpeakingId(null);
          URL.revokeObjectURL(url);
          const done = doneRef.current;
          doneRef.current = null;
          done?.();
        };
        await audio.play();
        return true;
      } catch {
        setSpeakingId(null);
        const done = doneRef.current;
        doneRef.current = null;
        done?.();
        return false;
      }
    },
    [voice, stop]
  );

  return { speak, stop, speakingId };
}

/** Web Speech API mic → text; falls back to PCM capture + server STT
 * when the browser doesn't ship SpeechRecognition.
 *
 * Language Mirror: when ON, the browser's locale-locked SpeechRecognition
 * is BYPASSED — every utterance goes through the server capture path,
 * which tries several locales until one understands the language you
 * actually spoke. onText receives the server-detected language. */
export function useDictation(onText: (t: string, lang?: string) => void) {
  const [listening, setListening] = useState(false);
  const [busy, setBusy] = useState(false);
  const recRef = useRef<unknown>(null);
  const capRef = useRef<VoiceCapture | null>(null);
  const langMirror = useDeepInit((s) => s.voice.langMirror);
  const mirrorRef = useRef(langMirror);
  useEffect(() => {
    mirrorRef.current = langMirror;
  }, [langMirror]);

  // computed at render — this component only mounts on the client
  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {};
  const srSupported = !!w.SpeechRecognition || !!w.webkitSpeechRecognition;
  const pcmSupported = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  const supported = srSupported || pcmSupported;

  const finishCapture = useCallback(
    async (cap: VoiceCapture) => {
      capRef.current = null;
      setListening(false);
      setBusy(true);
      const r = await cap.stop(true);
      setBusy(false);
      if (r.text?.trim()) onText(r.text.trim(), r.lang);
    },
    [onText]
  );

  const toggle = useCallback(() => {
    if (listening || busy) {
      try {
        (recRef.current as { stop: () => void } | null)?.stop();
      } catch {
        /* already stopped */
      }
      recRef.current = null;
      const cap = capRef.current;
      if (cap) void finishCapture(cap);
      else setListening(false);
      return;
    }
    if (srSupported && !mirrorRef.current) {
      // Browser SpeechRecognition only when the Language Mirror is OFF —
      // it is locked to the browser's locale and would mangle other languages.
      const SR = (w.SpeechRecognition || w.webkitSpeechRecognition) as
        | (new () => {
            continuous: boolean;
            interimResults: boolean;
            lang: string;
            onresult: (e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void;
            onend: () => void;
            onerror: () => void;
            start: () => void;
            stop: () => void;
          })
        | undefined;
      if (!SR) return;
      const rec = new SR();
      rec.continuous = false;
      rec.interimResults = false;
      rec.lang = typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US";
      rec.onresult = (e) => {
        const t = e.results?.[0]?.[0]?.transcript || "";
        if (t) onText(t);
      };
      rec.onend = () => setListening(false);
      rec.onerror = () => setListening(false);
      recRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch {
        setListening(false);
      }
      return;
    }
    // compatibility path — PCM capture, transcribed server-side
    // (multi-locale when the Language Mirror is on)
    setListening(true);
    void (async () => {
      const cap = await openVoiceCapture({
        lang: typeof navigator !== "undefined" ? navigator.language || "en-US" : "en-US",
        multiLang: mirrorRef.current,
        onAutoCommit: (c) => void finishCapture(c),
      });
      if (!cap) {
        setListening(false);
        return;
      }
      capRef.current = cap;
    })();
  }, [listening, busy, srSupported, w, onText, finishCapture]);

  return { listening: listening || busy, supported, toggle };
}

export function VoiceControls({ speak }: { speak: (t: string, id?: string) => Promise<boolean | void> }) {
  const voice = useDeepInit((s) => s.voice);
  const setVoice = useDeepInit((s) => s.setVoice);
  const agentName = useDeepInit((s) => s.profile.agentName);
  const t = useT();
  const [testing, setTesting] = useState(false);

  const test = async () => {
    setTesting(true);
    await speak(`Hello, I am ${agentName || "your agent"}. I can speak like this, all day, every day.`, "test");
    setTesting(false);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 shrink-0 font-mono text-[11px]" aria-label="Voice settings">
          <AudioLines className="mr-1 h-3.5 w-3.5 text-primary" />
          voice
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <Label className="text-sm font-semibold">Natural voice</Label>
            <Switch checked={voice.enabled} onCheckedChange={(v) => setVoice({ enabled: v })} aria-label="Enable voice" />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Persona</Label>
            <div className="grid gap-1.5">
              {VOICE_PRESETS.map((p) => (
                <button
                  key={p.voice}
                  onClick={() => setVoice({ voice: p.voice })}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-xs transition-colors ${
                    voice.voice === p.voice
                      ? "border-primary/60 bg-primary/10"
                      : "border-border hover:border-primary/40"
                  }`}
                >
                  <span className="font-medium">{p.name}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{p.voice.replace(/Neural$/, "")}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-xs">Rate</Label>
              <span className="font-mono text-[10px] text-muted-foreground">{voice.rate > 0 ? `+${voice.rate}%` : `${voice.rate}%`}</span>
            </div>
            <Slider value={[voice.rate]} min={-40} max={40} step={5} onValueChange={([v]) => setVoice({ rate: v })} />
            <div className="flex items-center justify-between">
              <Label className="text-xs">Pitch</Label>
              <span className="font-mono text-[10px] text-muted-foreground">{voice.pitch > 0 ? `+${voice.pitch}Hz` : `${voice.pitch}Hz`}</span>
            </div>
            <Slider value={[voice.pitch]} min={-40} max={40} step={5} onValueChange={([v]) => setVoice({ pitch: v })} />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/70 px-3 py-2">
            <Label className="text-xs">Auto-speak replies</Label>
            <Switch checked={voice.autoSpeak} onCheckedChange={(v) => setVoice({ autoSpeak: v })} aria-label="Auto speak" />
          </div>

          {/* Language Mirror — speak any language, get answered in the same one */}
          <div className="rounded-lg border border-border/70 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">{t("vm.langMirrorTitle")}</Label>
              <Switch
                checked={voice.langMirror}
                onCheckedChange={(v) => setVoice({ langMirror: v })}
                aria-label={t("vm.langMirrorTitle")}
              />
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t("vm.langMirrorDesc")}</p>
          </div>

          <Button variant="outline" className="w-full font-mono text-xs" onClick={test} disabled={testing || !voice.enabled}>
            {testing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Volume2 className="mr-2 h-3.5 w-3.5" />}
            Hear {agentName || "the agent"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MicButton({ onText }: { onText: (t: string, lang?: string) => void }) {
  const { listening, supported, toggle } = useDictation(onText);
  if (!supported) return null;
  return (
    <Button
      variant={listening ? "default" : "ghost"}
      size="icon"
      className={`mb-1 h-9 w-9 shrink-0 ${listening ? "di-glow" : ""}`}
      onClick={toggle}
      aria-label={listening ? "Stop dictation" : "Start dictation"}
    >
      {listening ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
    </Button>
  );
}

/* ============================================================
 * Voice mode — hands-free conversation with the agent.
 *
 * A state machine over the browser's SpeechRecognition:
 *   listening → (final transcript, silence debounce) → thinking
 *   thinking  → (reply arrives + is spoken aloud)    → speaking
 *   speaking  → (utterance ends)                     → listening
 *
 * Server-side ASR is intentionally NOT used: speech recognition runs
 * in the browser (Chrome / Edge / Safari), so voice mode works on any
 * deployment — including serverless, where no audio intake endpoint
 * exists. Replies are spoken with the existing neural TTS gateway.
 * ============================================================ */

export type VoiceModeState = "off" | "listening" | "thinking" | "speaking";

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

export function useVoiceMode(opts: { onSend: (text: string, lang?: string) => void; lang?: string }) {
  const [state, setState] = useState<VoiceModeState>("off");
  const [interim, setInterim] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [compat, setCompat] = useState(false); // PCM capture + server STT engine
  const langMirror = useDeepInit((s) => s.voice.langMirror);
  const mirrorRef = useRef(langMirror);
  useEffect(() => {
    mirrorRef.current = langMirror;
  }, [langMirror]);
  const [supported] = useState(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as Record<string, unknown>;
    const sr = Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
    const pcm = Boolean(navigator.mediaDevices?.getUserMedia);
    return sr || pcm; // voice mode starts even without SR — compat engine covers it
  });

  const stateRef = useRef<VoiceModeState>("off");
  const compatRef = useRef(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const capRef = useRef<VoiceCapture | null>(null);
  const finalRef = useRef("");
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sendRef = useRef(opts.onSend);
  const langRef = useRef(opts.lang || "en-US");
  useEffect(() => {
    sendRef.current = opts.onSend;
    langRef.current = opts.lang || "en-US";
  }, [opts.onSend, opts.lang]);

  const go = useCallback((s: VoiceModeState) => {
    stateRef.current = s;
    setState(s);
  }, []);

  const setCompatMode = useCallback((v: boolean) => {
    compatRef.current = v;
    setCompat(v);
  }, []);

  const clearCommit = useCallback(() => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
  }, []);

  /* ---------------- compatibility engine (PCM → server STT) ---------------- */

  // pcmStart ⇄ pcmCommit are mutually recursive — call through refs
  const pcmStartRef = useRef<() => void>(() => undefined);
  const pcmCommitRef = useRef<() => void>(() => undefined);

  const pcmCommit = useCallback(async () => {
    const cap = capRef.current;
    capRef.current = null;
    if (!cap) return;
    go("thinking");
    const r = await cap.stop(true);
    if (stateRef.current === "off") return; // session ended while transcribing
    if (r.text && r.text.trim().length >= 2) {
      setLastError(null);
      sendRef.current(r.text.trim(), r.lang);
    } else {
      setLastError(r.error && r.error !== "no speech recognized" ? r.error : "stt-empty");
      // didn't catch it — reopen the mic so the session keeps flowing
      go("listening");
      pcmStartRef.current();
    }
  }, [go]);

  const pcmStart = useCallback(async () => {
    if (stateRef.current === "off") return;
    const cap = await openVoiceCapture({
      lang: langRef.current,
      multiLang: mirrorRef.current,
      onAutoCommit: (c) => {
        if (capRef.current === c) pcmCommitRef.current();
      },
    });
    if (!cap) {
      setLastError("mic-denied");
      go("off");
      return;
    }
    capRef.current = cap;
    if ((stateRef.current as VoiceModeState) === "off") {
      // session was toggled off while the mic permission prompt was up
      void cap.stop(false);
      capRef.current = null;
    }
  }, [go]);

  useEffect(() => {
    pcmStartRef.current = () => void pcmStart();
    pcmCommitRef.current = () => void pcmCommit();
  }, [pcmStart, pcmCommit]);

  /** switch from browser SpeechRecognition to the compat engine mid-session */
  const escalateToCompat = useCallback(
    (reason: string) => {
      if (compatRef.current) return;
      setCompatMode(true);
      setLastError(reason);
      try {
        recRef.current?.abort();
      } catch {
        /* already dead */
      }
      recRef.current = null;
      go("listening");
      void pcmStart();
    },
    [go, pcmStart, setCompatMode]
  );

  /* ---------------- browser SpeechRecognition engine ---------------- */

  const commit = useCallback(() => {
    clearCommit();
    const text = finalRef.current.replace(/\s+/g, " ").trim();
    finalRef.current = "";
    setInterim("");
    if (!text || text.length < 2) return;
    go("thinking");
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    sendRef.current(text);
  }, [clearCommit, go]);

  const startRec = useCallback(() => {
    const w = window as unknown as Record<string, unknown>;
    const SR = (w.SpeechRecognition || w.webkitSpeechRecognition) as
      | (new () => SpeechRecognitionLike)
      | undefined;
    if (!SR) return;
    try {
      recRef.current?.abort();
    } catch {
      /* nothing to abort */
    }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = langRef.current;
    rec.onresult = (e) => {
      let live = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalRef.current += r[0].transcript + " ";
        else live += r[0].transcript;
      }
      setInterim(live);
      if (finalRef.current.trim()) {
        clearCommit();
        // brief silence = end of utterance → send what we heard
        commitTimer.current = setTimeout(commit, 900);
      }
    };
    rec.onerror = (e) => {
      const code = e?.error || "";
      if (code === "not-allowed") {
        setLastError("mic-denied");
        go("off");
        return;
      }
      if (code === "network" || code === "audio-capture" || code === "service-not-allowed") {
        // vendor speech servers unreachable / capture dead → compat engine
        escalateToCompat(code);
        return;
      }
      /* no-speech / aborted → onend decides whether to restart */
    };
    rec.onend = () => {
      if (stateRef.current === "listening" && !compatRef.current) {
        // Chrome ends recognition segments periodically — keep the mic open
        setTimeout(() => {
          if (stateRef.current === "listening" && !compatRef.current) {
            try {
              recRef.current?.start();
            } catch {
              /* restart race — next onend retries */
            }
          }
        }, 250);
      }
    };
    recRef.current = rec;
    try {
      rec.start();
    } catch {
      /* start race — onend retries */
    }
  }, [commit, clearCommit, go, escalateToCompat]);

  const start = useCallback(() => {
    if (!supported) return false;
    setLastError(null);
    clearCommit();
    finalRef.current = "";
    setInterim("");
    go("listening");
    const w = window as unknown as Record<string, unknown>;
    if ((w.SpeechRecognition || w.webkitSpeechRecognition) && !mirrorRef.current) {
      // Language Mirror OFF → browser SpeechRecognition (its locale).
      // Mirror ON → server compat engine (multi-locale, any language).
      setCompatMode(false);
      startRec();
    } else {
      // no SpeechRecognition (or mirror on) → straight into compat capture
      setCompatMode(true);
      void pcmStart();
    }
    return true;
  }, [supported, clearCommit, go, startRec, pcmStart, setCompatMode]);

  const stop = useCallback(() => {
    clearCommit();
    finalRef.current = "";
    setInterim("");
    try {
      recRef.current?.abort();
    } catch {
      /* nothing to abort */
    }
    recRef.current = null;
    const cap = capRef.current;
    capRef.current = null;
    void cap?.stop(false);
    setCompatMode(false);
    go("off");
  }, [clearCommit, go, setCompatMode]);

  /** pause the mic while a message is in flight (manual sends included) */
  const hold = useCallback(() => {
    if (stateRef.current === "off") return;
    clearCommit();
    finalRef.current = "";
    setInterim("");
    go("thinking");
    try {
      recRef.current?.stop();
    } catch {
      /* already stopped */
    }
    if (capRef.current) {
      const cap = capRef.current;
      capRef.current = null;
      void cap.stop(false); // capture runs during sends — drop it silently
    }
  }, [clearCommit, go]);

  /** resume listening after the reply was spoken — the voice-mode loop */
  const listenAgain = useCallback(() => {
    if (stateRef.current === "off") return;
    clearCommit();
    finalRef.current = "";
    setInterim("");
    go("listening");
    // small beat so the speaker tails off before the mic reopens
    setTimeout(() => {
      if (stateRef.current !== "listening") return;
      if (compatRef.current) void pcmStart();
      else startRec();
    }, 350);
  }, [clearCommit, go, startRec, pcmStart]);

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* unmount */
      }
      void capRef.current?.stop(false);
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    []
  );

  return { state, interim, supported, compat, lastError, start, stop, hold, listenAgain };
}

/** Header pill that toggles the voice-mode session and shows its live state. */
export function VoiceModeButton({
  state,
  onToggle,
}: {
  state: VoiceModeState;
  onToggle: () => void;
}) {
  const t = useT();
  const active = state !== "off";
  const label =
    state === "listening"
      ? t("vm.listening")
      : state === "thinking"
        ? t("vm.thinking")
        : state === "speaking"
          ? t("vm.speaking")
          : t("vm.button");
  return (
    <Button
      variant={active ? "default" : "outline"}
      size="sm"
      className={`h-8 shrink-0 font-mono text-[11px] ${active ? "di-glow" : ""}`}
      onClick={onToggle}
      aria-label="Toggle voice mode"
    >
      {state === "thinking" ? (
        <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
      ) : state === "speaking" ? (
        <AudioLines className="mr-1 h-3.5 w-3.5" />
      ) : (
        <Mic className="mr-1 h-3.5 w-3.5" />
      )}
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}

/** Live status strip shown above the composer while a voice session runs. */
export function VoiceBar({
  state,
  interim,
  compat,
  note,
}: {
  state: VoiceModeState;
  interim: string;
  compat?: boolean;
  note?: string | null;
}) {
  const t = useT();
  if (state === "off") return null;
  const label =
    state === "listening"
      ? t("vm.listening")
      : state === "thinking"
        ? t("vm.thinking")
        : t("vm.speaking");
  const noteText =
    note === "mic-denied"
      ? t("vm.micDenied")
      : note === "stt-empty" || note === "stt-fail" || note === "stt-network"
        ? t("vm.sttFail")
        : null;
  return (
    <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
      {state === "thinking" ? (
        <Loader2 className="h-3 w-3 shrink-0 animate-spin text-primary" />
      ) : state === "speaking" ? (
        <AudioLines className="h-3 w-3 shrink-0 text-primary" />
      ) : (
        <Radio className="h-3 w-3 shrink-0 animate-pulse text-primary" />
      )}
      <span className="shrink-0 text-primary">{label}</span>
      {compat && <span className="shrink-0">· {t("vm.compat")}</span>}
      {state === "listening" && interim && <span className="truncate italic">“{interim}”</span>}
      {noteText && <span className="truncate text-amber-500">{noteText}</span>}
      {state === "speaking" && <span className="truncate">{t("vm.interruptHint")}</span>}
    </div>
  );
}
