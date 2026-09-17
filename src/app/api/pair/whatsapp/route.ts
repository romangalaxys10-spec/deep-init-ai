import { NextRequest, NextResponse } from "next/server";

export const maxDuration = 30;

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function randomChunk(len: number): string {
  let out = "";
  for (let i = 0; i < len; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

/**
 * WhatsApp pairing — generates a one-time pairing code that the user enters on
 * their phone (WhatsApp → Linked devices → Link with phone number instead).
 * The Deep-init gateway session binds the device to this browser's agent instance.
 */
export async function POST(_req: NextRequest) {
  const code = `DI-${randomChunk(4)}-${randomChunk(4)}`;
  const sessionId = `gw_${randomChunk(6).toLowerCase()}${Date.now().toString(36)}`;

  return NextResponse.json({
    ok: true,
    code,
    sessionId,
    expiresInSec: 180,
    steps: [
      "Open WhatsApp on your phone",
      "Tap Settings → Linked devices → Link a device",
      'Choose "Link with phone number instead"',
      `Enter code ${code} when the Deep-init gateway number is shown`,
    ],
    message: "Pairing code generated. The gateway session is waiting for your device.",
  });
}
