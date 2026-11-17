param([switch]$Rebuild)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$secretsDir = Join-Path $PSScriptRoot '.runtime\secrets'
New-Item -ItemType Directory -Force -Path $secretsDir | Out-Null
# 실습 전용 암호를 매번 출력하지 않고, 첫 시작에만 생성합니다.
foreach ($name in @('db-admin.txt', 'db-app.txt')) {
    $target = Join-Path $secretsDir $name
    if (-not (Test-Path -LiteralPath $target)) {
        $bytes = New-Object byte[] 32
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
        $secret = [BitConverter]::ToString($bytes).Replace('-', '').ToLowerInvariant()
        [System.IO.File]::WriteAllText($target, $secret)
    }
}
docker info --format '{{.OSType}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop의 Linux 엔진을 먼저 실행해 주세요.' }
if ($Rebuild) { docker compose up -d --build } else { docker compose up -d }
if ($LASTEXITCODE -ne 0) { throw '실습 환경 시작 실패. docker compose logs로 확인하세요.' }
Write-Output '실습 관측: http://127.0.0.1:18911/ (첫 수집까지 약 15초)'
Write-Output 'ERP 업무 조회: http://127.0.0.1:18910/api/orders'
