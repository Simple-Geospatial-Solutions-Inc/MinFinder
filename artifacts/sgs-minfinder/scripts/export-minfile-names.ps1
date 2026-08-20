#!/usr/bin/env pwsh
#
# Export every name MINFILE records for each occurrence.
#
# The app used to carry only the first two names (NAME1/NAME2) because that is
# all the flattened `minfile_occurrences_*.sql` export contains. The upstream
# Access distribution keeps them in `R08_Minfile_Names`, one row per name with a
# RANK — 51k names across 16k occurrences, up to 20 each. This writes the small
# CSV that build-db.mjs ingests.
#
# Windows-only (needs the Access ACE OLEDB provider) and run by hand like
# build-db.mjs — MINFILE ships a new .accdb a few times a year. The .accdb
# itself is ~242 MB and deliberately stays out of the repo; only this script and
# its ~1.3 MB output are committed.
#
#   pwsh scripts/export-minfile-names.ps1 -Accdb "C:\path\to\MinFile-pc.accdb"
#
# Opening a 242 MB .accdb through ACE takes a couple of minutes, more if the
# file lives on a cloud-synced drive. It is not hung.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string] $Accdb,

  # Defaults to attached_assets/minfile_names.csv at the repo root.
  [string] $Out
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Data

if (-not (Test-Path -LiteralPath $Accdb)) {
  throw "Access database not found: $Accdb"
}
if (-not $Out) {
  $Out = Join-Path $PSScriptRoot '..\..\..\attached_assets\minfile_names.csv'
}
$outDir = Split-Path -Parent $Out
if (-not (Test-Path -LiteralPath $outDir)) {
  throw "Output directory does not exist: $outDir"
}

# ACE 16.0 first, 12.0 as a fallback for machines with only the older Access
# runtime installed.
$installed = (New-Object System.Data.OleDb.OleDbEnumerator).GetElements() |
  Select-Object -ExpandProperty SOURCES_NAME
$provider = @('Microsoft.ACE.OLEDB.16.0', 'Microsoft.ACE.OLEDB.12.0') |
  Where-Object { $installed -contains $_ } |
  Select-Object -First 1
if (-not $provider) {
  throw 'No Microsoft.ACE.OLEDB provider found. Install the Access Database Engine.'
}

Write-Host "Reading $Accdb via $provider (this takes a few minutes)..."

$conn = New-Object System.Data.OleDb.OleDbConnection(
  "Provider=$provider;Data Source=$Accdb;Mode=Read")
$conn.Open()
try {
  # INNER JOIN on MINFILE_ID both resolves the internal key to the public
  # MINFILNO (the only identifier stable across exports) and drops the handful of
  # R08 rows whose occurrence no longer exists in E01.
  $cmd = $conn.CreateCommand()
  $cmd.CommandText = @'
SELECT e.MINFILNO, m.RANK, m.NAME
FROM E01_Minfile_Occurrences AS e
INNER JOIN R08_Minfile_Names AS m ON e.MINFILE_ID = m.MINFILE_ID
ORDER BY e.MINFILNO, m.RANK
'@
  $dt = New-Object System.Data.DataTable
  (New-Object System.Data.OleDb.OleDbDataAdapter $cmd).Fill($dt) | Out-Null
}
finally {
  $conn.Close()
}

# NAME and MINFILNO are space-padded in Access on roughly 40% of rows, so trim
# here rather than at query time on the device. RANK stays numeric all the way
# through: sorting it as text is what put the 10th name in NAME2 for 507
# occurrences in the original export.
$sb = New-Object System.Text.StringBuilder
[void]$sb.Append("MINFILNO,RANK,NAME`n")
$written = 0
$skipped = 0
$occs = New-Object 'System.Collections.Generic.HashSet[string]'
$maxRank = 0
foreach ($row in $dt.Rows) {
  $minfilno = ([string]$row.MINFILNO).Trim()
  $name = ([string]$row.NAME).Trim()
  $rank = [int]$row.RANK
  if ($minfilno -eq '' -or $name -eq '') { $skipped++; continue }
  # Names carry commas, ampersands, periods and parentheses, so the NAME field is
  # always quoted; embedded quotes are doubled.
  [void]$sb.Append("$minfilno,$rank,`"$($name.Replace('"', '""'))`"`n")
  [void]$occs.Add($minfilno)
  if ($rank -gt $maxRank) { $maxRank = $rank }
  $written++
}

[System.IO.File]::WriteAllText(
  $Out, $sb.ToString(), (New-Object System.Text.UTF8Encoding($false)))

Write-Host "Wrote $written name rows for $($occs.Count) occurrences (max rank $maxRank)"
if ($skipped -gt 0) { Write-Host "Skipped $skipped blank rows" }
Write-Host "-> $((Resolve-Path -LiteralPath $Out).Path)"
