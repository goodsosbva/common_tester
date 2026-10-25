$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$data = Join-Path $projectRoot '.local\postgres'
if (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION')) {
    $pgCtl = 'C:\Program Files\PostgreSQL\17\bin\pg_ctl.exe'
    & $pgCtl -D $data status *> $null
    if ($LASTEXITCODE -eq 0) {
        & $pgCtl -D $data -w stop
    } else {
        Write-Output 'Common Tester PostgreSQL is already stopped.'
    }
}
