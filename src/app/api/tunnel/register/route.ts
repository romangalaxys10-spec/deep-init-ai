import { NextRequest, NextResponse } from "next/server";
import { relay } from "@/lib/relay";
import { badRequest } from "@/lib/ssh";

export const maxDuration = 30;
export const runtime = "nodejs";

function randomToken(len: number): string {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += A[Math.floor(Math.random() * A.length)];
  return out;
}

function bashScript(baseUrl: string, id: string, token: string): string {
  return `#!/usr/bin/env bash
# ============================================
#  deep-init pair tunnel — machine agent v1.0
#  Pairs this machine with your Deep-init agent.
#  Keep this file private: it can run commands here.
# ============================================
DI_ID="${id}"
DI_TOKEN="${token}"
DI_URL="${baseUrl}"
POLL=5   # seconds between check-ins

json_get() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1',''))" 2>/dev/null; }
json_out() { python3 -c "import sys,json;print(json.dumps({'id':'$DI_ID','token':'$DI_TOKEN','commandId':sys.argv[1],'result':sys.stdin.read()}))" "$1"; }

echo "[deep-init] pairing machine -> $DI_URL (id=$DI_ID)"
while true; do
  UP=\$(uptime -p 2>/dev/null || uptime | sed 's/^ *//' | head -c 120)
  SYS=\$(uname -sr | head -c 120)
  RESP=\$(curl -s --max-time 25 -X POST "\$DI_URL/api/tunnel/checkin" \\
    -H 'Content-Type: application/json' \\
    -d "{\\"id\\":\\"$DI_ID\\",\\"token\\":\\"$DI_TOKEN\\",\\"hostname\\":\\"$(hostname)\\",\\"os\\":\\"$(uname -s | tr '[:upper:]' '[:lower:]')\\",\\"uptime\\":\\"$UP\\",\\"sysinfo\\":\\"$SYS\\"}")

  CMD=\$(echo "\$RESP" | json_get command)
  CID=\$(echo "\$RESP" | json_get commandId)

  if [ -n "\$CMD" ] && [ -n "\$CID" ]; then
    echo "[deep-init] executing: \$CMD"
    OUT=\$(eval "\$CMD" 2>&1 | head -c 4000)
    echo "\$OUT" | json_out "\$CID" | curl -s --max-time 25 -X POST "\$DI_URL/api/tunnel/result" \\
      -H 'Content-Type: application/json' --data-binary @- >/dev/null
  fi

  sleep "\$POLL"
done
`;
}

function powershellScript(baseUrl: string, id: string, token: string): string {
  return `# ============================================
#  deep-init pair tunnel — machine agent v1.0 (Windows / WSL PowerShell)
#  Pairs this machine with your Deep-init agent.
#  Keep this file private: it can run commands here.
# ============================================
$DI_ID = "${id}"
$DI_TOKEN = "${token}"
$DI_URL = "${baseUrl}"
$POLL = 5

Write-Host "[deep-init] pairing machine -> $DI_URL (id=$DI_ID)"
while ($true) {
  try {
    $os = "windows"
    $hostname = $env:COMPUTERNAME
    $up = "up since $((Get-CimInstance Win32_OperatingSystem).LastBootUpTime)"
    $sys = (Get-CimInstance Win32_OperatingSystem).Caption

    $body = @{ id = $DI_ID; token = $DI_TOKEN; hostname = $hostname; os = $os; uptime = $up; sysinfo = $sys } | ConvertTo-Json
    $resp = Invoke-RestMethod -Uri "$DI_URL/api/tunnel/checkin" -Method Post -Body $body -ContentType "application/json" -TimeoutSec 25

    if ($resp.command -and $resp.commandId) {
      Write-Host "[deep-init] executing: $($resp.command)"
      try {
        $out = (Invoke-Expression $resp.command 2>&1 | Out-String)
      } catch {
        $out = $_.Exception.Message
      }
      if ($out.Length -gt 4000) { $out = $out.Substring(0, 4000) }

      $rb = @{ id = $DI_ID; token = $DI_TOKEN; commandId = $resp.commandId; result = $out } | ConvertTo-Json
      Invoke-RestMethod -Uri "$DI_URL/api/tunnel/result" -Method Post -Body $rb -ContentType "application/json" -TimeoutSec 25 | Out-Null
    }
  } catch {
    Write-Host "[deep-init] check-in failed: $($_.Exception.Message)"
  }
  Start-Sleep -Seconds $POLL
}
`;
}

export async function POST(req: NextRequest) {
  let body: { name?: string; os?: string };
  try {
    body = await req.json();
  } catch {
    return badRequest("Invalid JSON body");
  }

  const name = (body.name || "").trim().slice(0, 60);
  const os = ["linux", "darwin", "windows"].includes(body.os || "") ? body.os! : "linux";
  if (!name) return badRequest("Give the machine a name (e.g. \"Home Rig\", \"Hetzner VPS\")");

  const id = `di_${randomToken(10)}`;
  const token = `dit_${randomToken(28)}`;

  relay.set(id, {
    id,
    token,
    name,
    os,
    createdAt: new Date().toISOString(),
    commands: [],
  });

  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const baseUrl = `${proto}://${host}`;

  return NextResponse.json({
    ok: true,
    id,
    token,
    name,
    os,
    bash: bashScript(baseUrl, id, token),
    powershell: powershellScript(baseUrl, id, token),
    quickstart: {
      linux_mac: `curl -fsSL "${baseUrl}/api/tunnel/script?id=${id}&token=${token}" | bash`,
      windows: `Download: ${baseUrl}/api/tunnel/script?id=${id}&token=${token}&shell=powershell — then: powershell -ExecutionPolicy Bypass -File deep-init-pair.ps1`,
    },
  });
}
