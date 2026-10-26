$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$postgresBin = 'C:\Program Files\PostgreSQL\17\bin'
$runtime = Join-Path $projectRoot '.local'
$data = Join-Path $runtime 'postgres'
$passwordFile = Join-Path $runtime 'postgres-password'
$logFile = Join-Path $runtime 'postgres.log'
$python = Join-Path $projectRoot '.venv\Scripts\python.exe'

if (-not (Test-Path -LiteralPath (Join-Path $postgresBin 'initdb.exe'))) {
    throw 'PostgreSQL 17 실행 파일을 찾을 수 없습니다.'
}
if (-not (Test-Path -LiteralPath $python)) {
    throw '먼저 README의 Python 가상환경과 패키지 설치 단계를 실행하십시오.'
}
if (-not (Test-Path -LiteralPath $runtime)) {
    New-Item -ItemType Directory -Path $runtime | Out-Null
}

if (-not (Test-Path -LiteralPath (Join-Path $data 'PG_VERSION'))) {
    $password = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(18)).ToLowerInvariant()
    Set-Content -LiteralPath $passwordFile -Value $password -Encoding ascii -NoNewline
    & (Join-Path $postgresBin 'initdb.exe') -D $data -U common_tester --auth-host=scram-sha-256 --auth-local=scram-sha-256 --pwfile=$passwordFile --encoding=UTF8 --no-instructions
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL 데이터 디렉터리를 만들지 못했습니다.' }
}

& (Join-Path $postgresBin 'pg_ctl.exe') -D $data status *> $null
if ($LASTEXITCODE -ne 0) {
    & (Join-Path $postgresBin 'pg_ctl.exe') -D $data -l $logFile -o '-h 127.0.0.1 -p 55432' -w start
    if ($LASTEXITCODE -ne 0) { throw 'Common Tester PostgreSQL을 시작하지 못했습니다.' }
}

$env:PGPASSWORD = (Get-Content -LiteralPath $passwordFile -Raw).Trim()
$databaseExists = & (Join-Path $postgresBin 'psql.exe') -X -h 127.0.0.1 -p 55432 -U common_tester -d postgres -tA -c "SELECT 1 FROM pg_database WHERE datname = 'common_tester'"
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL에 연결하지 못했습니다.' }
if ($databaseExists -ne '1') {
    & (Join-Path $postgresBin 'createdb.exe') -h 127.0.0.1 -p 55432 -U common_tester common_tester
    if ($LASTEXITCODE -ne 0) { throw 'common_tester 데이터베이스를 만들지 못했습니다.' }
}

$env:DATABASE_URL = "postgresql://common_tester:$($env:PGPASSWORD)@127.0.0.1:55432/common_tester"
if (-not $env:OPENAI_API_KEY) {
    $envFile = Join-Path $projectRoot '.env'
    if (Test-Path -LiteralPath $envFile) {
        foreach ($line in Get-Content -LiteralPath $envFile) {
            if ($line -match '^\s*OPENAI_API_KEY\s*=\s*(.*?)\s*$') {
                $apiKey = $Matches[1].Trim().Trim('"').Trim("'")
                if ($apiKey) { $env:OPENAI_API_KEY = $apiKey }
            }
        }
    }
}
Write-Host 'Common Tester PostgreSQL: 127.0.0.1:55432'
Write-Host 'Common Tester API: http://127.0.0.1:8000/docs'
Push-Location (Join-Path $projectRoot 'api')
try {
    & $python -m uvicorn app.main:app --host 127.0.0.1 --port 8000
} finally {
    Pop-Location
}
