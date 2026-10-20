# install.ps1 (irm | iex, the spot-lyric command) under Windows PowerShell 5.1 (CI): a local stand-in
# for the update site (worker/: /latest, /archive/<tag>.zip, /install.ps1 as UTF-8 text) serving the
# working tree as releases, a synthetic Spotify and a throw-away LOCALAPPDATA.
#   install through irm | iex -> irm | iex again (update) -> spot-lyric update to a new release -> uninstall
#   powershell -NoProfile -ExecutionPolicy Bypass -File tests\install_test.ps1
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$root = Split-Path -Parent $PSScriptRoot
$work = Join-Path ([IO.Path]::GetTempPath()) ('spot-lyric-install-' + [Guid]::NewGuid().ToString('N'))
$site = Join-Path $work 'site'
$null = New-Item -ItemType Directory -Force -Path (Join-Path $site 'archive')
$env:LOCALAPPDATA = Join-Path $work 'local'
$null = New-Item -ItemType Directory -Force -Path $env:LOCALAPPDATA
$data = Join-Path $env:LOCALAPPDATA 'SpotLyric'
$bin = Join-Path $data 'bin'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')

# synthetic Spotify
$apps = Join-Path (Join-Path $work 'Spotify') 'Apps'
$null = New-Item -ItemType Directory -Force -Path $apps
$spa = Join-Path $apps 'xpui.spa'
$zip = [IO.Compression.ZipFile]::Open($spa, [IO.Compression.ZipArchiveMode]::Create)
foreach ($e in @(@('index.html', '<html><body><div id="main"></div></body></html>'), @('xpui.js', ('x' * 5000)))) {
    $w = New-Object IO.StreamWriter($zip.CreateEntry($e[0]).Open()); $w.Write($e[1]); $w.Dispose()
}
$zip.Dispose()
$original = (Get-FileHash $spa).Hash
$spotify = Split-Path -Parent $apps
function Marker { $z = [IO.Compression.ZipFile]::OpenRead($spa); try { $html = (New-Object IO.StreamReader($z.GetEntry('index.html').Open())).ReadToEnd() } finally { $z.Dispose() }; if ($html -match 'spot-lyric:start v(\S+)') { $Matches[1] } else { '' } }

# releases of the working tree
$files = @(git -C $root ls-files -co --exclude-standard | Where-Object { $_ -notlike 'docs/*' })
function New-Release([string]$V) {
    $build = Join-Path $work 'build'
    Remove-Item -LiteralPath $build -Recurse -Force -ErrorAction SilentlyContinue
    $stage = Join-Path $build "spotify-patch-lyric-$V"
    foreach ($f in $files) {
        $target = Join-Path $stage $f
        $null = New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target)
        Copy-Item -LiteralPath (Join-Path $root $f) -Destination $target
    }
    [IO.File]::WriteAllText((Join-Path $stage 'VERSION'), "$V`n")
    $archive = Join-Path $site "archive\v$V.zip"
    Remove-Item -LiteralPath $archive -Force -ErrorAction SilentlyContinue
    [IO.Compression.ZipFile]::CreateFromDirectory($build, $archive)
    [IO.File]::WriteAllText((Join-Path $site 'latest'), "{`"tag`":`"v$V`",`"version`":`"$V`",`"notes`":`"`",`"url`":`"x`"}")
}
New-Release '1.5.0'
Copy-Item -LiteralPath (Join-Path $root 'install.ps1') -Destination (Join-Path $site 'install.ps1')

# the update site: same content types as the Worker
$port = Get-Random -Minimum 20000 -Maximum 40000
$server = @"
import http.server, functools
class H(http.server.SimpleHTTPRequestHandler):
    def guess_type(self, path):
        if path.endswith('.ps1'): return 'text/plain; charset=utf-8'
        if path.endswith('latest'): return 'application/json'
        return 'application/zip'
    def log_message(self, *a): pass
http.server.ThreadingHTTPServer(('127.0.0.1', $port), functools.partial(H, directory=r'$site')).serve_forever()
"@
$serverFile = Join-Path $work 'site.py'
[IO.File]::WriteAllText($serverFile, $server)
$py = Start-Process -FilePath python -ArgumentList "`"$serverFile`"" -PassThru -WindowStyle Hidden
$env:SPOT_LYRIC_SITE = "http://127.0.0.1:$port"
for ($i = 0; $i -lt 50; $i++) { try { $null = Invoke-WebRequest "$env:SPOT_LYRIC_SITE/latest" -UseBasicParsing -TimeoutSec 2; break } catch { Start-Sleep -Milliseconds 200 } }

$fail = 0
function Check([string]$Name, [bool]$Ok) { if ($Ok) { Write-Host "  ok   $Name" } else { Write-Host "  FAIL $Name" -ForegroundColor Red; $script:fail++ } }
$shell = [Diagnostics.Process]::GetCurrentProcess().MainModule.FileName
function Run([string]$Command) { $out = & $shell -NoProfile -ExecutionPolicy Bypass -Command $Command 2>&1 | Out-String; Write-Host $out; return $out }

try {
    Write-Host '== irm | iex: fresh install (options through a script block)'
    $out = Run "& ([scriptblock]::Create((irm '$env:SPOT_LYRIC_SITE/install.ps1'))) --mode cloud --request server --no-hook --no-restart -y --spotify-path '$spotify'; 'window-still-open'"
    Check 'plugin v1.5.0 injected' ((Marker) -eq '1.5.0')
    Check 'release unpacked' (([IO.File]::ReadAllText((Join-Path $data 'app\VERSION'))).Trim() -eq '1.5.0')
    Check 'Chinese text intact through irm' ($out -match '以后更新')
    Check 'the shell window is kept (no exit)' ($out -match 'window-still-open')
    Check 'spot-lyric.cmd and spot-lyric.ps1' ((Test-Path (Join-Path $bin 'spot-lyric.cmd')) -and (Test-Path (Join-Path $bin 'spot-lyric.ps1')))
    $head = [IO.File]::ReadAllBytes((Join-Path $bin 'spot-lyric.ps1'))[0..2]
    Check 'spot-lyric.ps1 has a UTF-8 BOM' (($head[0] -eq 0xEF) -and ($head[1] -eq 0xBB) -and ($head[2] -eq 0xBF))
    Check 'bin on the user PATH' (([Environment]::GetEnvironmentVariable('Path', 'User')).Split(';') -contains $bin)
    Check 'settings recorded' ((Get-Content (Join-Path $data 'config')) -contains 'mode=cloud')

    Write-Host '== irm | iex again: installed, so update without questions'
    $out = Run "irm '$env:SPOT_LYRIC_SITE/install.ps1' | iex; 'window-still-open'"
    Check 'already the latest release' ($out -match '已是最新版本 v1\.5\.0')
    Check 'no wizard' ($out -notmatch '选择使用方式')
    Check 'the shell window is kept' ($out -match 'window-still-open')

    Write-Host '== spot-lyric update: new release v1.5.1'
    New-Release '1.5.1'
    $out = & (Join-Path $bin 'spot-lyric.cmd') update --no-restart --spotify-path $spotify 2>&1 | Out-String
    $code = $LASTEXITCODE
    Write-Host $out
    Check 'exit code 0' ($code -eq 0)
    Check 'downloaded v1.5.1' ($out -match 'v1\.5\.0 → v1\.5\.1')
    Check 'plugin v1.5.1 injected' ((Marker) -eq '1.5.1')
    Check 'settings kept' ((Get-Content (Join-Path $data 'config')) -contains 'request=server')
    Check 'no leftovers' (-not (Test-Path (Join-Path $data 'app.old')))

    Write-Host '== spot-lyric uninstall'
    $out = & (Join-Path $bin 'spot-lyric.cmd') uninstall -y --no-restart --spotify-path $spotify 2>&1 | Out-String
    $code = $LASTEXITCODE
    Write-Host $out
    Check 'exit code 0' ($code -eq 0)
    Check 'Spotify restored byte-identical' ((Get-FileHash $spa).Hash -eq $original)
    Check 'release removed' (-not (Test-Path (Join-Path $data 'app')))
    Check 'bin removed from the user PATH' (-not (([string][Environment]::GetEnvironmentVariable('Path', 'User')).Split(';') -contains $bin))
    Start-Sleep -Seconds 5
    Check 'spot-lyric.cmd deleted after it finished' (-not (Test-Path (Join-Path $bin 'spot-lyric.cmd')))
} finally {
    [Environment]::SetEnvironmentVariable('Path', $userPath, 'User')
    Stop-Process -Id $py.Id -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}
if ($fail) { Write-Host "$fail check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host 'all install checks passed'
