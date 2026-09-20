$ErrorActionPreference='Stop'
$scoreRoot=Split-Path $PSScriptRoot -Parent
$scoreApp=Join-Path $scoreRoot 'apps/web'
$env:PYTHON_BIN='C:\Users\USER\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$env:PYTHONPATH=Join-Path $PSScriptRoot 'runtime-python-deps'
$env:NODE_USE_SYSTEM_CA='1'
$scoreProcess=Start-Process -FilePath 'C:\nvm4w\nodejs\node.exe' -ArgumentList 'node_modules/next/dist/bin/next','dev','--hostname','0.0.0.0' -WorkingDirectory $scoreApp -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $PSScriptRoot 'studio-dev.log') -RedirectStandardError (Join-Path $PSScriptRoot 'studio-dev-error.log')
Write-Output "Score Studio started (process $($scoreProcess.Id))."
