# ============================================================
# 一键部署到 GitHub Pages（在项目目录内运行）
# 前置：1) js/config.js 已填入 Supabase URL 和 Key
#        2) 已在 Supabase SQL Editor 执行 supabase-schema.sql
#        3) 已登录 GitHub（gh auth login）
# ============================================================
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# 0. 检查 config.js 是否已配置
$cfg = Get-Content "js/config.js" -Raw
if ($cfg -match "PASTE_YOUR") {
  Write-Host "[错误] js/config.js 还是占位符，请先填入 Supabase URL 和 Key" -ForegroundColor Red
  exit 1
}

# 1. 检查 gh 登录
gh auth status *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "请先登录 GitHub：运行 gh auth login" -ForegroundColor Yellow
  gh auth login
}

# 2. 获取仓库名（默认 wenwan-collection）
$repoName = Read-Host "仓库名（默认 wenwan-collection）"
if (-not $repoName) { $repoName = "wenwan-collection" }
$user = gh api user --jq .login

# 3. 初始化 git（幂等）
if (-not (Test-Path ".git")) {
  git init | Out-Null
  git checkout -b main 2>$null | Out-Null
}
git add .
git commit -m "文玩手串收藏馆 v2：多账号 + 云端同步" 2>$null | Out-Null

# 4. 创建 GitHub 仓库并推送
$repoExists = gh repo view "$user/$repoName" *> $null
if ($LASTEXITCODE -ne 0) {
  gh repo create "$repoName" --public --source . --push
  Write-Host "已创建仓库并推送" -ForegroundColor Green
} else {
  git remote remove origin 2>$null | Out-Null
  git remote add origin "https://github.com/$user/$repoName.git"
  git push -u origin main --force
  Write-Host "已推送到已有仓库" -ForegroundColor Green
}

# 5. 启用 GitHub Pages（从 main 分支）
gh api -X POST "repos/$user/$repoName/pages" -f "source[branch]=main" -f "source[path]=/" 2>$null | Out-Null
if ($LASTEXITCODE -ne 0) {
  gh api -X PUT "repos/$user/$repoName/pages" -f "source[branch]=main" -f "source[path]=/" 2>$null | Out-Null
}
Start-Sleep -Seconds 5
$url = "https://$user.github.io/$repoName/"
Write-Host ""
Write-Host "================" -ForegroundColor Cyan
Write-Host "部署完成！" -ForegroundColor Green
Write-Host "访问地址：$url" -ForegroundColor Cyan
Write-Host "首次部署可能需要 1-2 分钟生效" -ForegroundColor Yellow
Write-Host "================" -ForegroundColor Cyan