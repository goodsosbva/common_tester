$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$api = 'http://127.0.0.1:8000'
$policy = Get-Content -LiteralPath (Join-Path $root 'examples\policies\order-name-v1.json') -Raw
Invoke-RestMethod -Method Post -Uri "$api/api/policies" -ContentType 'application/json' -Body $policy | Out-Null

function Invoke-Plan($file) {
    $json = Get-Content -LiteralPath (Join-Path $root "examples\$file") -Raw
    $plan = $json | ConvertFrom-Json
    $body = @{ project_id = $plan.project_id; route = $plan.route; policy_version = $plan.policy_version } | ConvertTo-Json -Compress
    $run = Invoke-RestMethod -Method Post -Uri "$api/api/runs" -ContentType 'application/json' -Body $body
    Invoke-RestMethod -Method Put -Uri "$api/api/runs/$($run.id)/plan" -ContentType 'application/json' -Body $json | Out-Null
    return Invoke-RestMethod -Method Post -Uri "$api/api/runs/$($run.id)/execute"
}

$normal = Invoke-Plan 'normal-plan.json'
if ($normal.status -ne 'passed' -or $normal.result.passed -ne 2) {
    throw "정상 화면 검사 실패: $($normal.id) / $($normal.status)"
}

$bug = Invoke-Plan 'bug-plan.json'
if ($bug.status -ne 'failed' -or $bug.result.passed -ne 0) {
    throw "오류 화면을 발견하지 못했습니다: $($bug.id) / $($bug.status)"
}
if (-not (Test-Path -LiteralPath $bug.result.cases[0].screenshot) -or
    -not (Test-Path -LiteralPath $bug.result.cases[0].trace)) {
    throw '실패 화면의 캡처 또는 trace가 없습니다.'
}
$saved = Invoke-RestMethod -Uri "$api/api/runs/$($bug.id)"
if ($saved.status -ne 'failed' -or $saved.result.cases[0].status -ne 'failed') {
    throw '실패 결과가 DB에 저장되지 않았습니다.'
}

Write-Output "정상 화면: $($normal.result.passed)/$($normal.result.total) 통과 (run $($normal.id))"
Write-Output "오류 화면: $($bug.result.passed)/$($bug.result.total) 통과, 결함 발견 (run $($bug.id))"
Write-Output "캡처: $($bug.result.cases[0].screenshot)"
Write-Output "trace: $($bug.result.cases[0].trace)"
