#requires -Version 5.1
<#
.SYNOPSIS
  准备 MySQL / MariaDB 便携版实例，用于 DBCraft 认证 Spike。

.NOTES
  下载与数据目录默认放在 $env:TEMP\dbcraft-mysql-auth，不进仓库。
  只监听 127.0.0.1：MySQL 3307，MariaDB 3308。
#>
param(
  [string]$BaseDir = (Join-Path $env:TEMP 'dbcraft-mysql-auth'),
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

$mysqlZipUrl = 'https://cdn.mysql.com/Downloads/MySQL-8.0/mysql-8.0.44-winx64.zip'
$mariaZipUrl = 'https://mirrors.tuna.tsinghua.edu.cn/mariadb/mariadb-11.4.13/winx64-packages/mariadb-11.4.13-winx64.zip'

$mysqlRoot = Join-Path $BaseDir 'mysql'
$mariaRoot = Join-Path $BaseDir 'mariadb'
$mysqlData = Join-Path $BaseDir 'mysql-data'
$mariaData = Join-Path $BaseDir 'mariadb-data'
$mysqlPid = Join-Path $BaseDir 'mysql.pid'
$mariaPid = Join-Path $BaseDir 'mariadb.pid'

New-Item -ItemType Directory -Force -Path $BaseDir | Out-Null

function Get-Zip([string]$Url, [string]$Destination) {
  if ((Test-Path $Destination) -and -not $Force) {
    Write-Host "reuse $Destination"
    return
  }
  Write-Host "download $Url"
  & curl.exe -L --fail --retry 3 -o $Destination $Url
  if ($LASTEXITCODE -ne 0) { throw "download failed: $Url" }
}

function Expand-IfMissing([string]$Zip, [string]$Destination) {
  if (Test-Path $Destination) {
    Write-Host "reuse $Destination"
    return
  }
  Write-Host "extract $Zip -> $Destination"
  Expand-Archive -Path $Zip -DestinationPath $Destination -Force
}

function Stop-Stale([string]$PidFile) {
  if (-not (Test-Path $PidFile)) { return }
  $processId = Get-Content $PidFile -ErrorAction SilentlyContinue
  if ($processId) {
    Stop-Process -Id $processId -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
  }
  Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
}

function Wait-Port([int]$Port, [int]$Seconds = 60) {
  for ($i = 0; $i -lt $Seconds; $i++) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $client.Connect('127.0.0.1', $Port)
      $client.Close()
      return $true
    } catch {
      Start-Sleep -Seconds 1
    } finally {
      $client.Dispose()
    }
  }
  return $false
}

# --- MySQL ---------------------------------------------------------------
Get-Zip $mysqlZipUrl (Join-Path $BaseDir 'mysql.zip')
Expand-IfMissing (Join-Path $BaseDir 'mysql.zip') $mysqlRoot

$mysqlHome = Get-ChildItem $mysqlRoot -Directory | Where-Object { $_.Name -like 'mysql-*-winx64' } | Select-Object -First 1
if (-not $mysqlHome) { throw 'MySQL directory not found after extract' }

Stop-Stale $mysqlPid

if ((Test-Path $mysqlData) -and $Force) {
  Remove-Item $mysqlData -Recurse -Force
}

if (-not (Test-Path (Join-Path $mysqlData 'mysql'))) {
  Write-Host 'initialize MySQL data directory'
  & (Join-Path $mysqlHome.FullName 'bin\mysqld.exe') --initialize-insecure --basedir="$($mysqlHome.FullName)" --datadir="$mysqlData"
  if ($LASTEXITCODE -ne 0) { throw 'mysqld --initialize-insecure failed' }
}

Write-Host 'start MySQL on 127.0.0.1:3307'
$mysqlProcess = Start-Process -FilePath (Join-Path $mysqlHome.FullName 'bin\mysqld.exe') `
  -ArgumentList @(
    "--basedir=$($mysqlHome.FullName)",
    "--datadir=$mysqlData",
    '--port=3307',
    '--bind-address=127.0.0.1',
    '--mysqlx=0',
    '--skip-log-bin'
  ) `
  -RedirectStandardOutput (Join-Path $BaseDir 'mysql.out.log') `
  -RedirectStandardError (Join-Path $BaseDir 'mysql.err.log') `
  -PassThru -WindowStyle Hidden
Set-Content -Path $mysqlPid -Value $mysqlProcess.Id
if (-not (Wait-Port 3307)) { throw 'MySQL did not open port 3307; see mysql.err.log' }
Write-Host "MySQL ready (pid $($mysqlProcess.Id))"

# --- MariaDB -------------------------------------------------------------
Get-Zip $mariaZipUrl (Join-Path $BaseDir 'mariadb.zip')
Expand-IfMissing (Join-Path $BaseDir 'mariadb.zip') $mariaRoot

$mariaHome = Get-ChildItem $mariaRoot -Directory | Where-Object { $_.Name -like 'mariadb-*-winx64' } | Select-Object -First 1
if (-not $mariaHome) { throw 'MariaDB directory not found after extract' }

Stop-Stale $mariaPid

if ((Test-Path $mariaData) -and $Force) {
  Remove-Item $mariaData -Recurse -Force
}

if (-not (Test-Path (Join-Path $mariaData 'mysql'))) {
  Write-Host 'initialize MariaDB data directory'
  & (Join-Path $mariaHome.FullName 'bin\mariadb-install-db.exe') `
    --datadir="$mariaData"
  if ($LASTEXITCODE -ne 0) { throw 'mariadb-install-db failed' }
}

Write-Host 'start MariaDB on 127.0.0.1:3308'
$mariaProcess = Start-Process -FilePath (Join-Path $mariaHome.FullName 'bin\mariadbd.exe') `
  -ArgumentList @(
    "--basedir=$($mariaHome.FullName)",
    "--datadir=$mariaData",
    '--port=3308',
    '--bind-address=127.0.0.1',
    '--skip-name-resolve'
  ) `
  -RedirectStandardOutput (Join-Path $BaseDir 'mariadb.out.log') `
  -RedirectStandardError (Join-Path $BaseDir 'mariadb.err.log') `
  -PassThru -WindowStyle Hidden
Set-Content -Path $mariaPid -Value $mariaProcess.Id
if (-not (Wait-Port 3308)) { throw 'MariaDB did not open port 3308; see mariadb.err.log' }
Write-Host "MariaDB ready (pid $($mariaProcess.Id))"

Write-Host ''
Write-Host "MySQL     127.0.0.1:3307  data=$mysqlData"
Write-Host "MariaDB   127.0.0.1:3308  data=$mariaData"
Write-Host "logs      $BaseDir"
