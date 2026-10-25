$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$api = 'http://127.0.0.1:8000'
$policy = Get-Content -LiteralPath (Join-Path $root 'examples\policies\order-name-v1.json') -Raw
Invoke-RestMethod -Method Post -Uri "$api/api/policies" -ContentType 'application/json' -Body $policy | Out-Null

$runBody = @{ project_id = 'demo-orders'; route = '/fixtures/order.html'; policy_version = 'v1' } | ConvertTo-Json -Compress
$run = Invoke-RestMethod -Method Post -Uri "$api/api/runs" -ContentType 'application/json' -Body $runBody
$objective = @{ objective = '주문명은 20자까지 허용하고 21자는 오류를 표시해야 한다. 이 경계를 검사하는 실행계획을 만들어라.' } | ConvertTo-Json -Compress
$generated = Invoke-RestMethod -Method Post -Uri "$api/api/runs/$($run.id)/generate" -ContentType 'application/json' -Body $objective
if ($generated.generation.status -ne 'completed' -or $generated.generation.calls.Count -lt 1) {
    throw '모델의 도구 호출과 실행계획 생성이 완료되지 않았습니다.'
}
if ($generated.generation.calls[0].name -ne 'search_policy') {
    throw '첫 모델 도구 호출이 정책 검색이 아닙니다.'
}
if ($generated.plan.cases.Count -lt 1) { throw '검증된 테스트 사례가 없습니다.' }

$saved = Invoke-RestMethod -Uri "$api/api/runs/$($run.id)"
if ($saved.plan.cases.Count -lt 1 -or $saved.generation.calls.Count -lt 1) {
    throw '생성 계획 또는 도구 기록이 DB에 저장되지 않았습니다.'
}

Write-Output "실제 모델 호출 완료: run $($run.id)"
Write-Output "도구 호출 $($generated.generation.calls.Count)회, 테스트 사례 $($generated.plan.cases.Count)개"
Write-Output "모델: $($generated.generation.model), 토큰: $($generated.generation.total_tokens)"
