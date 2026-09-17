import { NextRequest, NextResponse } from "next/server";
import { MsEdgeTTS, OUTPUT_FORMAT } from "msedge-tts";

export const maxDuration = 60;
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  let body: { text?: string; voice?: string; rate?: number; pitch?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const text = (body.text || "").trim().slice(0, 2000);
  if (!text) {
    return NextResponse.json({ error: "text is required" }, { status: 400 });
  }
  const voice = (body.voice || "en-US-AvaNeural").slice(0, 64);
  const rate = Math.max(-50, Math.min(50, Number(body.rate) || 0));
  const pitch = Math.max(-50, Math.min(50, Number(body.pitch) || 0));

  try {
    const tts = new MsEdgeTTS({ enableLogger: false });
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(text, { rate: `${rate}%`, pitch: `${pitch}Hz` } as never);

    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      audioStream.on("data", (c: Buffer) => chunks.push(c));
      audioStream.on("end", () => resolve());
      audioStream.on("error", reject);
      const t = setTimeout(() => reject(new Error("TTS timeout")), 45_000);
      audioStream.on("end", () => clearTimeout(t));
    });

    const audio = Buffer.concat(chunks);
    if (!audio.length) {
      return NextResponse.json({ error: "TTS returned no audio" }, { status: 502 });
    }
    return new NextResponse(audio, {
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "TTS synthesis failed" },
      { status: 502 }
    );
  }
}
