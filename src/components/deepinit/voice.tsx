"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VOICE_PRESETS, useDeepInit } from "@/lib/store";
import { AudioLines, Loader2, Mic, MicOff, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

/** Synthesize speech via the edge-tts gateway and play it. */
export function useSpeak() {
  const voice = useDeepInit((s) => s.voice);
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const stop = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setSpeakingId(null);
  }, []);

  const speak = useCallback(
    async (text: string, id = "manual") => {
      const clean = text
        .replace(/```[\s\S]*?```/g, " code block omitted. ")
        .replace(/[*_#>`~|-]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200);
      if (!clean) return;
      stop();
      setSpeakingId(id);
      try {
        const res = await fetch("/api/voice/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: clean, voice: voice.voice, rate: voice.rate, pitch: voice.pitch }),
        });
        if (!res.ok) {
          setSpeakingId(null);
          return false;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;
        audio.onended = () => {
          setSpeakingId(null);
          URL.revokeObjectURL(url);
        };
        await audio.play();
        return true;
      } catch {
        setSpeakingId(null);
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
