# Build the C++ engine (optional). Requires MSVC (cl) or MinGW (g++) in PATH.
# Usage: powershell -ExecutionPolicy Bypass -File cpp/build_windows.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$cpp = Join-Path $root 'cpp\engine.cpp'
$outExe = Join-Path $root 'cpp\engine.exe'

if (Get-Command cl -ErrorAction SilentlyContinue) {
  Write-Host 'Building with MSVC cl.exe...'
  Push-Location (Join-Path $root 'cpp')
  cl /nologo /EHsc /O2 /std:c++17 engine.cpp /Fe:engine.exe
  Pop-Location
  Write-Host "Built: $outExe"
  exit 0
}

if (Get-Command g++ -ErrorAction SilentlyContinue) {
  Write-Host 'Building with g++...'
  & g++ -O2 -std=c++17 "$cpp" -o "$outExe"
  Write-Host "Built: $outExe"
  exit 0
}

if (Get-Command clang++ -ErrorAction SilentlyContinue) {
  Write-Host 'Building with clang++...'
  & clang++ -O2 -std=c++17 "$cpp" -o "$outExe"
  Write-Host "Built: $outExe"
  exit 0
}

Write-Error 'No C++ compiler found (cl/g++/clang++). Install Visual Studio Build Tools or MinGW-w64, then re-run.'
