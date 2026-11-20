param([int]$Port = 8000, [switch]$Install)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$venvPython = Join-Path $PSScriptRoot '.venv/Scripts/python.exe'
if (!(Test-Path -LiteralPath $venvPython)) {
    $bundledPython = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
    if (Test-Path -LiteralPath $bundledPython) { & $bundledPython -m venv .venv }
    else { python -m venv .venv }
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12+ and retry.' }
    $Install = $true
}
if ($Install) {
    & $venvPython -m pip install -r requirements.txt
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
if (!(Test-Path -LiteralPath '.env')) { Copy-Item -LiteralPath '.env.example' -Destination '.env' }
Write-Host "StartWork: http://127.0.0.1:$Port"
Write-Host 'Press Ctrl+C to stop. Add your ChatAnywhere key to DEEPSEEK_API_KEY in .env to enable AI.'
& $venvPython -m uvicorn app.main:app --host 127.0.0.1 --port $Port
