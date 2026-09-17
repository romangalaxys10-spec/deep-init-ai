import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/asr";

export const maxDuration = 60;
export const runtime = "nodejs";

/**
 * POST /api/voice/stt — speech-to-text for the web voice-mode
 * compatibility capture (and any client with a mic).
 *
 * Body (either):
 *  - JSON:  { audio: "<base64>", mime?: "audio/wav", lang?: "en-US" }
 *  - multipart form: file=<audio bytes>, lang=<locale>
 *
 * Accepts WAV (16-bit/float, any rate — browser PCM capture) and
 * OGG/Opus (Telegram-style voice notes); transcription is keyless
 * and works on every deployment.
 */
export async function POST(req: NextRequest) {
  let bytes: Buffer | null = null;
  let mime = "";
  let lang = "en-US";

  const ctype = req.headers.get("content-type") || "";
  try {
    if (ctype.includes("multipart/form-data")) {
      const form = await req.formData();
      const file = form.get("file") || form.get("audio");
      if (file instanceof Blob) {
        bytes = Buffer.from(await file.arrayBuffer());
        mime = file.type || ctype;
      }
      const l = form.get("lang");
      if (typeof l === "string" && l.trim()) lang = l;
    } else {
      const body = (await req.json()) as { audio?: string; mime?: string; lang?: string };
      if (body.audio) {
        const clean = body.audio.includes(",") && body.audio.startsWith("data:")
          ? body.audio.slice(body.audio.indexOf(",") + 1)
          : body.audio;
        bytes = Buffer.from(clean, "base64");
        mime = body.mime || "audio/wav";
      }
      if (body.lang?.trim()) lang = body.lang;
    }
  } catch {
    return NextResponse.json({ error: "invalid request body" }, { status: 400 });
  }

  if (!bytes?.length) {
    return NextResponse.json({ error: "audio bytes are required" }, { status: 400 });
  }

  try {
    const r = await transcribeAudio(bytes, mime, lang);
    if (r.text) {
      return NextResponse.json({ text: r.text, via: r.via });
    }
    return NextResponse.json(
      { error: r.error || "no speech recognized" },
      { status: r.error && /unsupported|decode|too long/.test(r.error) ? 415 : 422 }
    );
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "transcription failed" },
      { status: 502 }
    );
  }
}
