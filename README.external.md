# Spot-Lyric for Spotify

Spotify 桌面客户端第三方歌词插件，支持 Windows / macOS / Linux。

项目地址：https://github.com/dibin666/spotify-patch-lyric

## 界面预览

![逐字高亮 · 双语译文 · 自动跟随滚动](https://cdn.jsdelivr.net/gh/dibin666/spotify-patch-lyric@main/docs/screenshots/word-sync.171026b2.webp)

*逐字高亮 · 双语译文 · 自动跟随滚动*

![三种背景：封面取色 · 封面模糊 · 深色](https://cdn.jsdelivr.net/gh/dibin666/spotify-patch-lyric@main/docs/screenshots/backgrounds.93fdb1d0.webp)

*三种背景：封面取色 · 封面模糊 · 深色*

| 右侧栏迷你歌词（同样逐字高亮） | 手动搜索与匹配 |
| :---: | :---: |
| ![右侧栏迷你歌词（同样逐字高亮）](https://cdn.jsdelivr.net/gh/dibin666/spotify-patch-lyric@main/docs/screenshots/mini.a96e03e6.webp) | ![手动搜索与匹配](https://cdn.jsdelivr.net/gh/dibin666/spotify-patch-lyric@main/docs/screenshots/match.fc1912b2.webp) |
| **预览候选歌词并绑定** | **歌词来源与显示设置** |
| ![预览候选歌词并绑定](https://cdn.jsdelivr.net/gh/dibin666/spotify-patch-lyric@main/docs/screenshots/preview.44beb8bc.webp) | ![歌词来源与显示设置](https://cdn.jsdelivr.net/gh/dibin666/spotify-patch-lyric@main/docs/screenshots/settings.ae99a804.webp) |
| **时间校准与网络** | **上传前检查服务器，确认后覆盖** |
| ![时间校准与网络](https://cdn.jsdelivr.net/gh/dibin666/spotify-patch-lyric@main/docs/screenshots/network.9de96b2d.webp) | ![上传前检查服务器，确认后覆盖](https://cdn.jsdelivr.net/gh/dibin666/spotify-patch-lyric@main/docs/screenshots/upload.b1394140.webp) |

## 功能

- 歌词来源：网易云音乐、QQ 音乐，Spotify 官方歌词兜底
- 逐字高亮、双语翻译
- 自动匹配，也可手动搜索、绑定、导入 LRC
- 右侧栏迷你歌词（同样逐字高亮）
- 背景：封面取色 / 封面模糊 / 深色
- 字号、时间偏移可调
- 提前匹配队列中接下来的两首歌，切歌即显示
- 可选云端服务器，多设备共享：只通过播放栏的上传按钮手动上传（歌词、匹配和偏移一起），服务器已有歌词时确认后才覆盖

## 安装

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/dibin666/spotify-patch-lyric/main/patch.sh | bash
```

**Windows**（PowerShell）

```powershell
$d="$env:TEMP\spot-lyric"; Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue; Invoke-WebRequest https://github.com/dibin666/spotify-patch-lyric/archive/refs/heads/main.zip -OutFile "$d.zip"; Expand-Archive "$d.zip" $d -Force; powershell -NoProfile -ExecutionPolicy Bypass -File (Get-ChildItem "$d\*\patch.ps1")[0].FullName
```

也可以下载[仓库](https://github.com/dibin666/spotify-patch-lyric)后，在仓库目录中运行 `./patch.sh`（Windows 为 `patch.cmd`），按提示选择即可。安装过之后再运行，会直接询问「更新 / 重新设置 / 卸载」，默认沿用上次的设置更新。

安装命令只下载补丁脚本和歌词插件；本地服务程序（spot-lyric-server）只在选择「纯本地」时才下载或编译。

> Windows 不支持 Microsoft Store 版 Spotify。

## 使用方式

| 方式 | 说明 |
| --- | --- |
| 云端服务器 | 多设备共享匹配（默认） |
| 纯本地 | 不连接任何远程服务器 |

## 命令

以下以 `./patch.sh` 为例，Windows 换成 `patch.cmd`。

| 操作 | 命令 |
| --- | --- |
| 安装 / 更新 | `./patch.sh` |
| 纯本地安装 | `./patch.sh --mode local -y` |
| 状态 | `./patch.sh status` |
| 还原 | `./patch.sh restore` |
| 卸载 | `./patch.sh uninstall` |

更多选项见 `./patch.sh --help`。

## 自建服务器（可选）

在[仓库](https://github.com/dibin666/spotify-patch-lyric)目录中：

```bash
cd server
cp .env.example .env
docker compose up -d --build
```

安装时填写服务器地址，或在「歌词设置 > 使用方式与网络」中修改。

## 开发

```bash
go vet ./... && go test ./...
node --test tests/*.test.mjs
```
[Linux DO](https://linux.do)
