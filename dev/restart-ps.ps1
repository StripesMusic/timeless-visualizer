# Dev-only: restarts Photoshop only if it has no documents open. Exits 3 without touching it otherwise.
$run = Join-Path $env:TEMP "tvdev"
New-Item -ItemType Directory -Force $run | Out-Null
$ps = "C:\Program Files\Adobe\Adobe Photoshop 2026\Photoshop.exe"
if (Get-Process Photoshop -ErrorAction SilentlyContinue) {
  $state = Join-Path $run "ps_state.txt"
  Remove-Item $state -ErrorAction SilentlyContinue
  $stateFwd = $state -replace '\\','/'
  $jsx = Join-Path $run "ps_state.jsx"
  @"
#target photoshop
(function () { var f = new File("$stateFwd"); f.open("w"); f.writeln(app.documents.length); f.close(); })();
"@ | Out-File -FilePath $jsx -Encoding ascii
  Start-Process -FilePath $ps -ArgumentList $jsx
  $d = (Get-Date).AddSeconds(25)
  while ((Get-Date) -lt $d -and -not (Test-Path $state)) { Start-Sleep -Milliseconds 300 }
  if (-not (Test-Path $state)) { "Photoshop did not answer"; exit 3 }
  $count = [int](Get-Content $state | Select-Object -First 1)
  if ($count -ne 0) { "Photoshop has $count document(s) open; not restarting"; exit 3 }
  $quit = Join-Path $run "ps_quit.jsx"
  @"
#target photoshop
executeAction(charIDToTypeID('quit'), undefined, DialogModes.NO);
"@ | Out-File -FilePath $quit -Encoding ascii
  Start-Process -FilePath $ps -ArgumentList $quit
  $d = (Get-Date).AddSeconds(40)
  while ((Get-Date) -lt $d -and (Get-Process Photoshop -ErrorAction SilentlyContinue)) { Start-Sleep -Milliseconds 500 }
  if (Get-Process Photoshop -ErrorAction SilentlyContinue) { "Photoshop did not quit"; exit 3 }
}
Remove-Item (Join-Path $PSScriptRoot "run\harness-loaded.json") -ErrorAction SilentlyContinue
Start-Process -FilePath $ps
"restarted"
