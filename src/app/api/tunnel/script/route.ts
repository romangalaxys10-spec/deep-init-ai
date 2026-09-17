import { NextRequest, NextResponse } from "next/server";
import { relay } from "@/lib/relay";

export const maxDuration = 30;
export const runtime = "nodejs";

/**
 * Serves the pair-tunnel agent script for a registered machine.
 * GET /api/tunnel/script?id=di_x&token=dit_y&shell=bash|powershell
 * The script embeds the machine token — anyone holding it can run commands,
 * so treat the URL like a secret.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  const token = url.searchParams.get("token") || "";
  const shell = url.searchParams.get("shell") === "powershell" ? "powershell" : "bash";

  if (!relay.verify(id, token)) {
    return NextResponse.json({ error: "unknown machine or bad token" }, { status: 401 });
  }

  const entry = relay.get(id)!;
  const proto = req.headers.get("x-forwarded-proto") || "http";
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || "localhost:3000";
  const baseUrl = `${proto}://${host}`;

  const bash = `#!/usr/bin/env bash
# ============================================
#  deep-init pair tunnel — machine agent v1.0
#  Pairs this machine with your Deep-init agent.
#  Keep this file private: it can run commands here.
# ============================================
DI_ID="${id}"
DI_TOKEN="${token}"
DI_URL="${baseUrl}"
POLL=5

json_get() { python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('$1',''))" 2>/dev/null; }

echo "[deep-init] pairing machine -> $DI_URL (id=$DI_ID)"
while true; do
  UP=$(uptime -p 2>/dev/null || uptime | sed 's/^ *//' | head -c 120)
  SYS=$(uname -sr | head -c 120)
  RESP=$(curl -s --max-time 25 -X POST "$DI_URL/api/tunnel/checkin" \\
    -H 'Content-Type: application/json' \\
    -d "{\\"id\\":\\"$DI_ID\\",\\"token\\":\\"$DI_TOKEN\\",\\"hostname\\":\\"$(hostname)\\",\\"os\\":\\"$(uname -s | tr '[:upper:]' '[:lower:]')\\",\\"uptime\\":\\"$UP\\",\\"sysinfo\\":\\"$SYS\\"}")

  CMD=$(echo "$RESP" | json_get command)
  CID=$(echo "$RESP" | json_get commandId)

  if [ -n "$CMD" ] && [ -n "$CID" ]; then
    echo "[deep-init] executing: $CMD"
    OUT=$(eval "$CMD" 2>&1 | head -c 4000)
    echo "$OUT" | python3 -c "import sys,json;print(json.dumps({'id':'$DI_ID','token':'$DI_TOKEN','commandId':sys.argv[1],'result':sys.stdin.read()}))" "$CID" | curl -s --max-time 25 -X POST "$DI_URL/api/tunnel/result" \\
      -H 'Content-Type: application/json' --data-binary @- >/dev/null
  fi

  sleep "$POLL"
done
`;

  const powershell = `# ============================================
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
    $hn = $env:COMPUTERNAME
    $up = "up since $((Get-CimInstance Win32_OperatingSystem).LastBootUpTime)"
    $sys = (Get-CimInstance Win32_OperatingSystem).Caption

    $body = @{ id = $DI_ID; token = $DI_TOKEN; hostname = $hn; os = $os; uptime = $up; sysinfo = $sys } | ConvertTo-Json
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

  const body = shell === "powershell" ? powershell : bash;
  const safeName = (entry.name || "machine").replace(/[^a-zA-Z0-9_-]+/g, "-");
  const filename =
    shell === "powershell" ? `deep-init-pair-${safeName}.ps1` : `deep-init-pair-${safeName}.sh`;

  return new NextResponse(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
