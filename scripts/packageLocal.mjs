import { cp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TextEncoder } from "node:util";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const distDir = path.join(rootDir, "dist");
const releaseRoot = path.join(rootDir, "local-release");
const releaseDir = path.join(releaseRoot, "roco-damage-calculator-local");

const batchLauncher = `@echo off
setlocal
cd /d "%~dp0"
set "PS=%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"
if not exist "%PS%" set "PS=powershell.exe"
"%PS%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0local-server.ps1"
if errorlevel 1 (
  echo.
  echo Failed to start. Please send a screenshot of this window to the maintainer.
  pause
)
`;

const powerShellServer = `$ErrorActionPreference = "Stop"

$Root = Join-Path $PSScriptRoot "dist"
$StartPort = 4173
$MaxPort = 4273

if (-not (Test-Path $Root)) {
  Write-Host "未找到 dist 目录，请确认文件夹完整。" -ForegroundColor Red
  exit 1
}

function Get-MimeType([string]$Path) {
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    ".html" { "text/html; charset=utf-8"; break }
    ".js" { "text/javascript; charset=utf-8"; break }
    ".mjs" { "text/javascript; charset=utf-8"; break }
    ".css" { "text/css; charset=utf-8"; break }
    ".json" { "application/json; charset=utf-8"; break }
    ".svg" { "image/svg+xml"; break }
    ".png" { "image/png"; break }
    ".jpg" { "image/jpeg"; break }
    ".jpeg" { "image/jpeg"; break }
    ".gif" { "image/gif"; break }
    ".webp" { "image/webp"; break }
    ".ico" { "image/x-icon"; break }
    ".txt" { "text/plain; charset=utf-8"; break }
    default { "application/octet-stream" }
  }
}

function Write-Response($Stream, [int]$StatusCode, [string]$StatusText, [byte[]]$Body, [string]$ContentType) {
  $Headers = @(
    "HTTP/1.1 $StatusCode $StatusText",
    "Content-Type: $ContentType",
    "Content-Length: $($Body.Length)",
    "Cache-Control: no-cache",
    "Connection: close",
    "",
    ""
  ) -join "\`r\`n"
  $HeaderBytes = [System.Text.Encoding]::UTF8.GetBytes($Headers)
  $Stream.Write($HeaderBytes, 0, $HeaderBytes.Length)
  if ($Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
}

function Resolve-RequestPath([string]$UrlPath) {
  $CleanPath = [System.Uri]::UnescapeDataString(($UrlPath -split "\\?")[0])
  if ([string]::IsNullOrWhiteSpace($CleanPath) -or $CleanPath -eq "/") {
    $CleanPath = "/index.html"
  }
  $CleanPath = $CleanPath -replace "/", [System.IO.Path]::DirectorySeparatorChar
  $RelativePath = $CleanPath.TrimStart([System.IO.Path]::DirectorySeparatorChar)
  $FullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $RelativePath))
  $RootFullPath = [System.IO.Path]::GetFullPath($Root)

  if (-not $FullPath.StartsWith($RootFullPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $null
  }

  if (Test-Path $FullPath -PathType Container) {
    $FullPath = Join-Path $FullPath "index.html"
  }

  if (Test-Path $FullPath -PathType Leaf) {
    return $FullPath
  }

  # Vite 单页应用刷新任意路径时回退到 index.html。
  return Join-Path $Root "index.html"
}

$Listener = $null
$Port = $StartPort
while ($Port -le $MaxPort) {
  try {
    $Listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse("127.0.0.1"), $Port)
    $Listener.Start()
    break
  } catch {
    $Port++
  }
}

if ($null -eq $Listener) {
  Write-Host "没有可用端口，请稍后再试。" -ForegroundColor Red
  exit 1
}

$Url = "http://127.0.0.1:$Port/"
Write-Host "洛克王国：世界 PVP 伤害计算器已启动：" -ForegroundColor Green
Write-Host $Url -ForegroundColor Cyan
Write-Host "关闭这个窗口即可停止服务。"
Start-Process $Url

try {
  while ($true) {
    $Client = $Listener.AcceptTcpClient()
    try {
      $Stream = $Client.GetStream()
      $Reader = [System.IO.StreamReader]::new($Stream, [System.Text.Encoding]::ASCII, $false, 1024, $true)
      $RequestLine = $Reader.ReadLine()
      while ($Reader.ReadLine()) {}

      if ([string]::IsNullOrWhiteSpace($RequestLine)) {
        continue
      }

      $Parts = $RequestLine.Split(" ")
      $Method = $Parts[0]
      $UrlPath = if ($Parts.Length -gt 1) { $Parts[1] } else { "/" }

      if ($Method -ne "GET" -and $Method -ne "HEAD") {
        $Body = [System.Text.Encoding]::UTF8.GetBytes("Method Not Allowed")
        Write-Response $Stream 405 "Method Not Allowed" $Body "text/plain; charset=utf-8"
        continue
      }

      $FilePath = Resolve-RequestPath $UrlPath
      if ($null -eq $FilePath) {
        $Body = [System.Text.Encoding]::UTF8.GetBytes("Forbidden")
        Write-Response $Stream 403 "Forbidden" $Body "text/plain; charset=utf-8"
        continue
      }

      $Bytes = [System.IO.File]::ReadAllBytes($FilePath)
      if ($Method -eq "HEAD") {
        $Bytes = [byte[]]::new(0)
      }
      Write-Response $Stream 200 "OK" $Bytes (Get-MimeType $FilePath)
    } catch {
      try {
        $Body = [System.Text.Encoding]::UTF8.GetBytes("Internal Server Error")
        Write-Response $Stream 500 "Internal Server Error" $Body "text/plain; charset=utf-8"
      } catch {}
    } finally {
      $Client.Close()
    }
  }
} finally {
  $Listener.Stop()
}
`;

const readme = `洛克王国：世界 PVP 伤害计算器 - 本地离线版

使用方法：
1. 解压整个文件夹，不要只复制单个文件。
2. 双击“启动计算器.bat”。
3. 浏览器会自动打开本地地址，例如 http://127.0.0.1:4173/。
4. 使用完后，关闭启动窗口即可停止服务。

注意事项：
- 本版本完全离线可用，不需要安装 Node、npm、Vite 或 Python。
- 首次运行时，如果 Windows 或杀毒软件提示脚本风险，请确认文件来源可信后允许运行。
- 这个脚本只在本机 127.0.0.1 提供静态网页，不会上传数据。
- 精灵预设和搜索历史保存在你自己的浏览器 localStorage 中。
- 如果无法启动，请把启动窗口里的错误截图发给维护者。
`;

function withUtf8Bom(content) {
  const bom = Uint8Array.from([0xef, 0xbb, 0xbf]);
  const body = new TextEncoder().encode(content);
  const bytes = new Uint8Array(bom.length + body.length);
  bytes.set(bom, 0);
  bytes.set(body, bom.length);
  return bytes;
}

await mkdir(releaseDir, { recursive: true });
await cp(distDir, path.join(releaseDir, "dist"), { recursive: true });
await writeFile(path.join(releaseDir, "启动计算器.bat"), batchLauncher, "ascii");
await writeFile(path.join(releaseDir, "local-server.ps1"), withUtf8Bom(powerShellServer));
await writeFile(path.join(releaseDir, "使用说明.txt"), withUtf8Bom(readme));

console.log(`本地离线包已生成：${releaseDir}`);
