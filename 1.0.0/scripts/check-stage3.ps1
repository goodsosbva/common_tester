$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$api = 'http://127.0.0.1:8000'

Get-ChildItem -LiteralPath (Join-Path $root 'examples\policies') -Filter '*.json' | ForEach-Object {
    $document = Invoke-RestMethod -Method Post -Uri "$api/api/policies" -ContentType 'application/json' -Body (Get-Content -LiteralPath $_.FullName -Raw)
    if ($document.chunk_count -lt 1) { throw "문단이 생성되지 않았습니다: $($_.Name)" }
}

$checks = @(
    @{ query = '주문명 최대 글자 수'; source = 'policy:demo-orders:order-name:v1:0' },
    @{ query = '주문 수량은 몇 개까지 가능한가'; source = 'policy:demo-orders:order-quantity:v1:0' },
    @{ query = '요청 금액에 음수를 넣어도 되나요'; source = 'policy:demo-orders:order-amount:v1:0' },
    @{ query = '메모는 필수인가요'; source = 'policy:demo-orders:order-note:v1:0' },
    @{ query = '재고가 부족하면 저장되나요'; source = 'policy:demo-orders:order-quantity:v1:1' }
)
foreach ($check in $checks) {
    $body = @{ project_id = 'demo-orders'; version = 'v1'; query = $check.query; top_k = 3 } | ConvertTo-Json -Compress
    $hits = Invoke-RestMethod -Method Post -Uri "$api/api/policies/search" -ContentType 'application/json' -Body $body
    if ($hits[0].source_id -ne $check.source) { throw "첫 검색 결과가 다릅니다: $($check.query)" }
}

$v2Body = @{ project_id = 'demo-orders'; version = 'v2'; query = '주문명 최대 글자 수'; top_k = 3 } | ConvertTo-Json -Compress
$v2Hits = Invoke-RestMethod -Method Post -Uri "$api/api/policies/search" -ContentType 'application/json' -Body $v2Body
if ($v2Hits.Count -ne 1 -or $v2Hits[0].source_id -ne 'policy:demo-orders:order-name:v2:0') {
    throw '정책 버전 필터가 잘못되었습니다.'
}
$source = Invoke-RestMethod -Uri "$api/api/policies/sources/$($checks[0].source)"
if ($source.content -notmatch '20자') { throw '근거 원문을 조회하지 못했습니다.' }

$runBody = @{ project_id = 'demo-orders'; route = '/fixtures/order.html'; policy_version = 'v1' } | ConvertTo-Json -Compress
$run = Invoke-RestMethod -Method Post -Uri "$api/api/runs" -ContentType 'application/json' -Body $runBody
$plan = Get-Content -LiteralPath (Join-Path $root 'examples\normal-plan.json') -Raw | ConvertFrom-Json
$plan.cases[0].evidence[0].source_id = 'policy:demo-orders:order-name:v2:0'
try {
    Invoke-WebRequest -Method Put -Uri "$api/api/runs/$($run.id)/plan" -ContentType 'application/json' -Body ($plan | ConvertTo-Json -Depth 20) | Out-Null
    throw '다른 정책 버전의 근거가 허용되었습니다.'
} catch {
    if ([int]$_.Exception.Response.StatusCode -ne 422) { throw }
}

Write-Output '정책 문서 5개 등록 및 문단 색인 확인'
Write-Output '한국어 질문 5개: 기대 문단 Top-1 5/5'
Write-Output 'v1/v2 버전 격리, 근거 원문 조회, 다른 버전 근거 거부 확인'
