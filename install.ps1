#Requires -Version 5.1
# Spot-Lyric for Spotify - install and update (Windows). macOS / Linux: install.sh.
#
#   irm https://lyric.564616.xyz | iex      install; update when installed
#
# Fetches the latest release into %LOCALAPPDATA%\SpotLyric\app and installs this script as the
# `spot-lyric` command (%LOCALAPPDATA%\SpotLyric\bin, added to the user PATH). patch.ps1 of that
# release does the actual work.
#
#   spot-lyric [update]   update to the latest release, keeping the settings (install when new)
#   spot-lyric setup      choose the usage mode again
#   spot-lyric status | restore | uninstall | help
#
# Run through "irm | iex" it shares the user's PowerShell window: no `exit`, no leftover variables.
# Saved without a BOM ("irm | iex" would read U+FEFF as part of the first command); the installed
# spot-lyric.ps1 gets one, so Windows PowerShell 5.1 reads the Chinese text as UTF-8.
& {
    $ErrorActionPreference = 'Stop'
    $ProgressPreference = 'SilentlyContinue'
    try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch { }
    try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

    $Repo = 'dibin666/spotify-patch-lyric'
    $Site = if ($env:SPOT_LYRIC_SITE) { $env:SPOT_LYRIC_SITE.TrimEnd('/') } else { 'https://lyric.564616.xyz' }
    $GitHub = "https://github.com/$Repo"
    $Data = if ($env:SPOT_LYRIC_DATA) { $env:SPOT_LYRIC_DATA } else { Join-Path $env:LOCALAPPDATA 'SpotLyric' }
    $App = Join-Path $Data 'app'
    $Bin = Join-Path $Data 'bin'
    $Argv = @($args)
    $State = @{ NewPath = $false }

    function Say([string]$Text) { Write-Host "[spot-lyric] $Text" -ForegroundColor Green }
    function Warn([string]$Text) { Write-Host "[spot-lyric] $Text" -ForegroundColor Yellow }
    function Stop-With([string]$Text) { Write-Host "[spot-lyric] $Text" -ForegroundColor Red; throw 'spot-lyric-stop' }

    function Get-InstalledVersion {
        $v = Join-Path $App 'VERSION'
        if ((Test-Path -LiteralPath $v) -and (Test-Path -LiteralPath (Join-Path $App 'patch.ps1'))) { return ([IO.File]::ReadAllText($v)).Trim() }
        return ''
    }
    function Get-LatestTag {
        try { $tag = (Invoke-RestMethod -Uri "$Site/latest" -TimeoutSec 20 -UseBasicParsing).tag; if ($tag -match '^v\d+\.\d+\.\d+$') { return $tag } } catch { }
        try {
            $tag = (Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest" -TimeoutSec 20 -UseBasicParsing -Headers @{ 'User-Agent' = 'spot-lyric' }).tag_name
            if ($tag -match '^v\d+\.\d+\.\d+$') { return $tag }
        } catch { }
        return ''
    }
    # Release source archive -> $App (the previous copy is replaced only after a complete download).
    function Get-Release([string]$Tag) {
        $tmp = Join-Path ([IO.Path]::GetTempPath()) ("spot-lyric-" + [Guid]::NewGuid().ToString('N'))
        $null = New-Item -ItemType Directory -Force -Path $tmp
        try {
            $source = $null
            foreach ($url in @("$Site/archive/$Tag.zip", "$GitHub/archive/refs/tags/$Tag.zip")) {
                $zip = Join-Path $tmp 'src.zip'; $out = Join-Path $tmp 'src'
                try {
                    Remove-Item -LiteralPath $out -Recurse -Force -ErrorAction SilentlyContinue
                    Invoke-WebRequest -Uri $url -OutFile $zip -TimeoutSec 120 -UseBasicParsing
                    Expand-Archive -LiteralPath $zip -DestinationPath $out -Force
                    $dir = Get-ChildItem -LiteralPath $out -Directory | Select-Object -First 1
                    if ($dir -and (Test-Path -LiteralPath (Join-Path $dir.FullName 'patch.ps1'))) { $source = $dir.FullName; break }
                } catch { Warn "下载失败：$url（$($_.Exception.Message)）" }
            }
            if (-not $source) { Stop-With "下载 $Tag 失败，请检查网络后重试" }
            $null = New-Item -ItemType Directory -Force -Path $Data
            Remove-Item -LiteralPath "$App.old" -Recurse -Force -ErrorAction SilentlyContinue
            if (Test-Path -LiteralPath $App) { Rename-Item -LiteralPath $App -NewName 'app.old' }
            Move-Item -LiteralPath $source -Destination $App
            Remove-Item -LiteralPath "$App.old" -Recurse -Force -ErrorAction SilentlyContinue
            # Downloaded files carry the "from the internet" mark; patch.ps1 must run without a prompt.
            try { Get-ChildItem -LiteralPath $App -Recurse -File | Unblock-File } catch { }
        } finally { Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue }
    }
    # Latest release in $App. Offline with a copy installed: keep using it.
    function Update-App {
        $have = Get-InstalledVersion
        $tag = Get-LatestTag
        if (-not $tag) {
            if (-not $have) { Stop-With "无法获取最新版本（$Site、github.com 都连不上），请检查网络后重试" }
            Warn "无法检查新版本，继续使用已安装的 v$have"; return
        }
        if ($have -eq $tag.Substring(1)) { Say "已是最新版本 $tag"; return }
        if ($have) { Say "发现新版本：v$have → $tag，正在下载…" } else { Say "下载 Spot-Lyric $tag…" }
        Get-Release $tag
    }
    function Confirm-App { if (-not (Get-InstalledVersion)) { Update-App } }

    # spot-lyric.cmd + spot-lyric.ps1 in $Bin, $Bin on the user PATH (new windows see it).
    function Install-Command {
        $null = New-Item -ItemType Directory -Force -Path $Bin
        $text = [IO.File]::ReadAllText((Join-Path $App 'install.ps1'), (New-Object System.Text.UTF8Encoding($false)))
        [IO.File]::WriteAllText((Join-Path $Bin 'spot-lyric.ps1'), $text, (New-Object System.Text.UTF8Encoding($true)))
        $cmd = "@echo off`r`nchcp 65001 >nul`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"%~dp0spot-lyric.ps1`" %*`r`n"
        [IO.File]::WriteAllText((Join-Path $Bin 'spot-lyric.cmd'), $cmd, (New-Object System.Text.ASCIIEncoding))
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        $parts = @(if ($userPath) { $userPath.Split(';') | Where-Object { $_ } })
        if ($parts -notcontains $Bin) {
            [Environment]::SetEnvironmentVariable('Path', (@($parts) + $Bin) -join ';', 'User')
            $State.NewPath = $true
        }
        if (([string]$env:Path).Split(';') -notcontains $Bin) { $env:Path = "$env:Path;$Bin" }
    }
    function Remove-Command {
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if ($userPath) {
            $parts = @($userPath.Split(';') | Where-Object { $_ -and $_ -ne $Bin })
            [Environment]::SetEnvironmentVariable('Path', ($parts -join ';'), 'User')
        }
        # spot-lyric.cmd may be the batch file running right now: delete it once it has finished.
        $cmdFile = Join-Path $Bin 'spot-lyric.cmd'
        Remove-Item -LiteralPath (Join-Path $Bin 'spot-lyric.ps1') -Force -ErrorAction SilentlyContinue
        try { Start-Process -WindowStyle Hidden -FilePath cmd.exe -ArgumentList "/c ping -n 3 127.0.0.1 >nul & del /f /q `"$cmdFile`" & rmdir `"$Bin`" & rmdir `"$Data`"" } catch { }
    }
    # patch.ps1 in its own PowerShell (its `exit` must not end this window), sharing this console
    # (prompts and colours as usual, nothing captured). Returns its exit code.
    function Invoke-Patch([string[]]$PatchArgs) {
        $quote = { param([string]$a) if ($a -eq '' -or $a -match '[\s"]') { '"' + (($a -replace '(\\*)"', '$1$1\"') -replace '(\\+)$', '$1$1') + '"' } else { $a } }
        $list = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (& $quote (Join-Path $App 'patch.ps1'))) + @($PatchArgs | ForEach-Object { & $quote ([string]$_) })
        $process = Start-Process -FilePath 'powershell.exe' -ArgumentList ($list -join ' ') -NoNewWindow -Wait -PassThru
        return [int]$process.ExitCode
    }
    function Show-Usage {
        $have = Get-InstalledVersion
        Write-Host @"
Spot-Lyric for Spotify$(if ($have) { " v$have" })

用法: spot-lyric [命令] [选项]

  spot-lyric             更新到最新版本，沿用当前设置（未安装时进入安装向导）
  spot-lyric update      同上
  spot-lyric setup       重新设置：选择使用方式、歌词服务器等
  spot-lyric status      查看安装状态
  spot-lyric restore     还原 Spotify 原始文件（保留设置）
  spot-lyric uninstall   卸载，并移除 spot-lyric 命令
  spot-lyric version     查看已安装和最新的版本

安装向导的选项（如 --mode local -y）同 patch.cmd，见 spot-lyric help-patch。
没有 spot-lyric 命令时，在 PowerShell 中运行：irm $Site | iex
"@
    }

    $code = 0
    try {
        $cmd = if ($Argv.Count) { [string]$Argv[0] } else { '' }
        $rest = @(if ($Argv.Count -gt 1) { $Argv[1..($Argv.Count - 1)] })
        # Options without a command (--mode local -y): the install wizard.
        if ($cmd.StartsWith('-') -and $cmd -notin '-h', '--help', '-help') { $rest = @($Argv); $cmd = 'install' }
        switch ($cmd.ToLower()) {
            { $_ -in '', 'update', 'install' } {
                Update-App
                Install-Command
                # Installed before (settings recorded): update without any question.
                if (-not $cmd) { $cmd = if (Test-Path -LiteralPath (Join-Path $Data 'config')) { 'update' } else { 'install' } }
                $code = Invoke-Patch (@($cmd) + $rest)
                if ($code -eq 0) {
                    if ($State.NewPath) { Say '以后更新：打开新的 PowerShell 窗口运行 spot-lyric' } else { Say '以后更新：运行 spot-lyric' }
                }
            }
            'setup' { Update-App; Install-Command; $code = Invoke-Patch (@('setup') + $rest) }
            'uninstall' {
                Confirm-App
                $code = Invoke-Patch (@('uninstall') + $rest)
                if ($code -eq 0) {
                    Remove-Item -LiteralPath $App -Recurse -Force -ErrorAction SilentlyContinue
                    Remove-Command
                    Say '已移除 spot-lyric 命令'
                }
            }
            { $_ -in 'version', '--version' } {
                $have = Get-InstalledVersion
                Write-Host "已安装：$(if ($have) { "v$have" } else { '未安装' })"
                $tag = Get-LatestTag
                Write-Host "最新：$(if ($tag) { $tag } else { '无法获取' })"
            }
            { $_ -in 'help', '-h', '--help', '-help' } { Show-Usage }
            'help-patch' { Confirm-App; $code = Invoke-Patch @('--help') }
            default { Confirm-App; $code = Invoke-Patch (@($cmd) + $rest) }
        }
    } catch {
        if ("$_" -ne 'spot-lyric-stop') { Write-Host "[spot-lyric] $_" -ForegroundColor Red }
        $code = 1
    }
    # Only the spot-lyric command (a script file) reports an exit code; "irm | iex" keeps the window.
    if ($PSCommandPath) { exit $code }
} @args
