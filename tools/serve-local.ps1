# Miitomo Web - local server (Windows PowerShell 5+, no install needed).
# Serves the built client (client/web/dist) on http://localhost:8173/ and, read-only, ONLY the user's own asset files
# listed below under /local/ so the page can import them without the file picker. Bound to localhost only.
# Nothing leaves this computer. Stop with Ctrl+C or by closing the window.
param([int]$Port = 8173, [ValidateSet("classic","reboot")][string]$Mode = "classic")
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$dist = Join-Path $root 'client\web\dist'
if (-not (Test-Path (Join-Path $dist 'index.html'))) { Write-Host "Manca client\web\dist\index.html (build del client)." -ForegroundColor Red; Read-Host 'Invio per chiudere'; exit 1 }

# Asset files the page may import (user's own copies, never committed)
$assets = @()
$assets += Get-ChildItem -Path $root -File -Filter 'Miitomo_*.apk' -ErrorAction SilentlyContinue
$assets += Get-ChildItem -Path $root -File -Filter 'asset_model_character_mii_AFLResHigh*.zip' -ErrorAction SilentlyContinue
$assets += Get-ChildItem -Path $root -File -Filter 'asset_env*.zip' -ErrorAction SilentlyContinue
$assets += Get-ChildItem -Path $root -File -Filter 'asset_model_character_animation_output.zip' -ErrorAction SilentlyContinue
$assets += Get-ChildItem -Path (Join-Path $root 'local-assets\cdn') -File -Filter '*.zip' -ErrorAction SilentlyContinue
$map = @{}
foreach ($f in $assets) { $map[$f.Name] = $f.FullName }
$list = ($assets | ForEach-Object { '{"name":"' + $_.Name + '","size":' + $_.Length + '}' }) -join ','
$listJson = [Text.Encoding]::UTF8.GetBytes('{"files":[' + $list + ']}')

$types = @{ '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'; '.css' = 'text/css; charset=utf-8'; '.wasm' = 'application/wasm'; '.json' = 'application/json'; '.png' = 'image/png'; '.svg' = 'image/svg+xml'; '.zip' = 'application/zip'; '.apk' = 'application/octet-stream' }
$l = New-Object System.Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
try { $l.Start() } catch { Write-Host "Porta $Port occupata o non disponibile: $($_.Exception.Message)" -ForegroundColor Red; Read-Host 'Invio per chiudere'; exit 1 }
$rb = if ($Mode -eq "reboot") { "1" } else { "0" }
$url = "http://localhost:$Port/?autoload=1&reboot=$rb"
Write-Host "Miitomo Web in esecuzione: $url" -ForegroundColor Green
Write-Host "$($assets.Count) file di asset disponibili per l'importazione. Chiudi questa finestra per fermare il server."
if (-not $env:MTW_NO_BROWSER) { Start-Process $url }
while ($l.IsListening) {
  $ctx = $l.GetContext(); $req = $ctx.Request; $res = $ctx.Response
  try {
    $p = [Uri]::UnescapeDataString($req.Url.AbsolutePath)
    $file = $null; $bytes = $null
    if ($p -eq '/local/list.json') { $bytes = $listJson; $res.ContentType = 'application/json' }
    elseif ($p.StartsWith('/local/')) { $n = $p.Substring(7); if ($map.ContainsKey($n)) { $file = $map[$n] } }
    else {
      if ($p -eq '/' -or $p -eq '') { $p = '/index.html' }
      $cand = [IO.Path]::GetFullPath((Join-Path $dist ($p.TrimStart('/') -replace '/', '\')))
      if ($cand.StartsWith([IO.Path]::GetFullPath($dist)) -and (Test-Path $cand -PathType Leaf)) { $file = $cand }
    }
    if ($bytes) { $res.ContentLength64 = $bytes.Length; $res.OutputStream.Write($bytes, 0, $bytes.Length) }
    elseif ($file) {
      $ext = [IO.Path]::GetExtension($file).ToLower()
      $res.ContentType = $(if ($types.ContainsKey($ext)) { $types[$ext] } else { 'application/octet-stream' })
      $res.Headers['Cache-Control'] = 'no-cache'
      $fs = [IO.File]::OpenRead($file); $res.ContentLength64 = $fs.Length; $fs.CopyTo($res.OutputStream); $fs.Close()
    } else { $res.StatusCode = 404 }
  } catch { try { $res.StatusCode = 500 } catch {} }
  finally { try { $res.OutputStream.Close() } catch {} }
}
