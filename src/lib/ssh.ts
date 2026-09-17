import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

export interface SSHCreds {
  host: string;
  port: number;
  username: string;
  auth: "password" | "key";
  password?: string;
  privateKey?: string;
}

export function readCreds(body: unknown): SSHCreds | null {
  const b = body as Partial<SSHCreds>;
  if (!b || !b.host || !b.username) return null;
  if (b.auth === "key" && !b.privateKey) return null;
  if (b.auth !== "key" && !b.password) return null;
  return {
    host: String(b.host).trim(),
    port: Number(b.port) || 22,
    username: String(b.username).trim(),
    auth: b.auth === "key" ? "key" : "password",
    password: b.password,
    privateKey: b.privateKey,
  };
}

export async function withSSH<T>(
  creds: SSHCreds,
  fn: (client: import("ssh2").Client) => Promise<T>,
  timeoutMs = 15_000
): Promise<T> {
  const { Client } = await import("ssh2");
  return new Promise<T>((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error(`Connection timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    conn
      .on("ready", () => {
        clearTimeout(timer);
        fn(conn)
          .then((r) => {
            conn.end();
            resolve(r);
          })
          .catch((e) => {
            conn.end();
            reject(e);
          });
      })
      .on("error", (e) => {
        clearTimeout(timer);
        reject(e);
      })
      .connect({
        host: creds.host,
        port: creds.port,
        username: creds.username,
        password: creds.auth === "password" ? creds.password : undefined,
        privateKey: creds.auth === "key" ? creds.privateKey : undefined,
        readyTimeout: timeoutMs,
        tryKeyboard: false,
      });
  });
}

export function runCommand(
  conn: import("ssh2").Client,
  command: string
): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    conn.exec(command, { pty: false }, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code: number | null) => resolve({ stdout, stderr, code }))
        .on("data", (d: Buffer) => (stdout += d.toString()))
        .stderr.on("data", (d: Buffer) => (stderr += d.toString()));
      const t = setTimeout(() => {
        stream.close();
        resolve({ stdout, stderr, code: null });
      }, 20_000);
      stream.on("close", () => clearTimeout(t));
    });
  });
}

export async function jsonOrBadRequest<T>(req: NextRequest): Promise<T | null> {
  try {
    return (await req.json()) as T;
  } catch {
    return null;
  }
}

export function badRequest(msg: string) {
  return NextResponse.json({ ok: false, error: msg }, { status: 400 });
}
