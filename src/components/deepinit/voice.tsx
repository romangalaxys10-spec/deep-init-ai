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

/** Web Speech API mic → text. Returns supported=false when unavailable. */
export function useDictation(onText: (t: string) => void) {
  const [listening, setListening] = useState(false);
  const recRef = useRef<unknown>(null);

  // computed at render — this component only mounts on the client
  const w = typeof window !== "undefined" ? (window as unknown as Record<string, unknown>) : {};
  const supported = !!w.SpeechRecognition || !!w.webkitSpeechRecognition;

  const toggle = useCallback(() => {
    const w = window as unknown as Record<string, unknown>;
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
    if (!SR) {
      return;
    }
    if (listening) {
      (recRef.current as { stop: () => void } | null)?.stop();
      setListening(false);
      return;
    }
    const rec = new SR();
    rec.continuous = false;
    rec.interimResults = false;
    rec.lang = "en-US";
    rec.onresult = (e) => {
      const t = e.results?.[0]?.[0]?.transcript || "";
      if (t) onText(t);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    recRef.current = rec;
    rec.start();
    setListening(true);
  }, [listening, onText]);

  return { listening, supported, toggle };
}

export function VoiceControls({ speak }: { speak: (t: string, id?: string) => Promise<boolean | void> }) {
  const voice = useDeepInit((s) => s.voice);
  const setVoice = useDeepInit((s) => s.setVoice);
  const agentName = useDeepInit((s) => s.profile.agentName);
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

          <Button variant="outline" className="w-full font-mono text-xs" onClick={test} disabled={testing || !voice.enabled}>
            {testing ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <Volume2 className="mr-2 h-3.5 w-3.5" />}
            Hear {agentName || "the agent"}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function MicButton({ onText }: { onText: (t: string) => void }) {
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

export function useVoiceMode(opts: { onSend: (text: string) => void; lang?: string }) {
  const [state, setState] = useState<VoiceModeState>("off");
  const [interim, setInterim] = useState("");
  const [lastError, setLastError] = useState<string | null>(null);
  const [supported] = useState(() => {
    if (typeof window === "undefined") return false;
    const w = window as unknown as Record<string, unknown>;
    return Boolean(w.SpeechRecognition || w.webkitSpeechRecognition);
  });

  const stateRef = useRef<VoiceModeState>("off");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
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

  const clearCommit = useCallback(() => {
    if (commitTimer.current) {
      clearTimeout(commitTimer.current);
      commitTimer.current = null;
    }
  }, []);

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
      if (code === "not-allowed" || code === "service-not-allowed") {
        setLastError(code);
        go("off");
      }
      /* no-speech / network / aborted → onend decides whether to restart */
    };
    rec.onend = () => {
      if (stateRef.current === "listening") {
        // Chrome ends recognition segments periodically — keep the mic open
        setTimeout(() => {
          try {
            recRef.current?.start();
          } catch {
            /* restart race — next onend retries */
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
  }, [commit, clearCommit, go]);

  const start = useCallback(() => {
    if (!supported) return false;
    setLastError(null);
    clearCommit();
    finalRef.current = "";
    setInterim("");
    go("listening");
    startRec();
    return true;
  }, [supported, clearCommit, go, startRec]);

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
    go("off");
  }, [clearCommit, go]);

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
      if (stateRef.current === "listening") startRec();
    }, 350);
  }, [clearCommit, go, startRec]);

  useEffect(
    () => () => {
      try {
        recRef.current?.abort();
      } catch {
        /* unmount */
      }
      if (commitTimer.current) clearTimeout(commitTimer.current);
    },
    []
  );

  return { state, interim, supported, lastError, start, stop, hold, listenAgain };
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
export function VoiceBar({ state, interim }: { state: VoiceModeState; interim: string }) {
  const t = useT();
  if (state === "off") return null;
  const label =
    state === "listening"
      ? t("vm.listening")
      : state === "thinking"
        ? t("vm.thinking")
        : t("vm.speaking");
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
      {state === "listening" && interim && <span className="truncate italic">“{interim}”</span>}
      {state === "speaking" && <span className="truncate">{t("vm.interruptHint")}</span>}
    </div>
  );
}
