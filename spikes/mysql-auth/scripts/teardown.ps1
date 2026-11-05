#requires -Version 5.1
<#
.SYNOPSIS
  停止 setup.ps1 启动的 MySQL / MariaDB 便携版实例。
#>
param(
  [string]$BaseDir = (Join-Path $env:TEMP 'dbcraft-mysql-auth'),
  [switch]$RemoveData
)

$ErrorActionPreference = 'Stop'

foreach ($name in @('mysql', 'mariadb')) {
  $pidFile = Join-Path $BaseDir "$name.pid"
  if (Test-Path $pidFile) {
    $processId = Get-Content $pidFile -ErrorAction SilentlyContinue
    if ($processId) {
      Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
      Write-Host "stopped $name (pid $processId)"
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
  }
}

if ($RemoveData) {
  foreach ($path in @(
      (Join-Path $BaseDir 'mysql-data'),
      (Join-Path $BaseDir 'mariadb-data')
    )) {
    if (Test-Path $path) {
      Remove-Item $path -Recurse -Force
      Write-Host "removed $path"
    }
  }
}

# 启动器进程可能先退出，真正的 mysqld/mariadbd 仍在监听端口；按可执行文件路径兜底清理。
Get-CimInstance Win32_Process |
  Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath.StartsWith($BaseDir, [System.StringComparison]::OrdinalIgnoreCase)
  } |
  ForEach-Object {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    Write-Host "stopped leftover $($_.Name) (pid $($_.ProcessId))"
  }

# ExecutablePath 有时不可读，再按监听端口兜底。
foreach ($port in @(3307, 3308)) {
  $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($listener) {
    Stop-Process -Id $listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "stopped leftover on port $port (pid $($listener.OwningProcess))"
  }
}
