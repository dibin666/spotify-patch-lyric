# Spot-Lyric for Spotify

Spotify 桌面客户端第三方歌词插件，支持 Windows / macOS / Linux。

## 界面预览

<p align="center">
  <img src="docs/screenshots/word-sync.171026b2.webp" width="100%" alt="逐字高亮与双语译文">
  <br><sub>逐字高亮 · 双语译文 · 自动跟随滚动 </sub>
</p>

<p align="center">
  <img src="docs/screenshots/backgrounds.93fdb1d0.webp" width="100%" alt="三种背景：封面取色、封面模糊、深色">
  <br><sub>三种背景：封面取色 · 封面模糊 · 深色</sub>
</p>

<table>
  <tr>
    <td align="center" width="50%"><a href="docs/screenshots/mini.a96e03e6.webp"><img src="docs/screenshots/mini.a96e03e6.webp" alt="右侧栏迷你歌词（同样逐字高亮）"></a><br><sub>右侧栏迷你歌词（同样逐字高亮）</sub></td>
    <td align="center" width="50%"><a href="docs/screenshots/match.fc1912b2.webp"><img src="docs/screenshots/match.fc1912b2.webp" alt="手动搜索与匹配"></a><br><sub>手动搜索与匹配</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="docs/screenshots/preview.44beb8bc.webp"><img src="docs/screenshots/preview.44beb8bc.webp" alt="预览候选歌词并绑定"></a><br><sub>预览候选歌词并绑定</sub></td>
    <td align="center" width="50%"><a href="docs/screenshots/settings.ae99a804.webp"><img src="docs/screenshots/settings.ae99a804.webp" alt="歌词来源与显示设置"></a><br><sub>歌词来源与显示设置</sub></td>
  </tr>
  <tr>
    <td align="center" width="50%"><a href="docs/screenshots/network.9de96b2d.webp"><img src="docs/screenshots/network.9de96b2d.webp" alt="时间校准与网络"></a><br><sub>时间校准与网络</sub></td>
    <td align="center" width="50%"><a href="docs/screenshots/upload.b1394140.webp"><img src="docs/screenshots/upload.b1394140.webp" alt="上传前检查服务器，确认后覆盖"></a><br><sub>上传前检查服务器，确认后覆盖</sub></td>
  </tr>
</table>

## 功能

- 歌词来源：网易云音乐、QQ 音乐，Spotify 官方歌词兜底
- 逐字高亮、双语翻译
- 自动匹配，也可手动搜索、绑定、导入 LRC
- 右侧栏迷你歌词（同样逐字高亮）
- 背景：封面取色 / 封面模糊 / 深色
- 字号、时间偏移可调
- 提前匹配队列中接下来的两首歌，切歌即显示
- 可选云端服务器，多设备共享：只通过播放栏的上传按钮手动上传（歌词、匹配和偏移一起），服务器已有歌词时确认后才覆盖

## 安装 / 更新

**Windows**（PowerShell）

```powershell
irm https://lyric.564616.xyz | iex
```

**macOS / Linux**（终端）

```bash
curl -fsSL https://lyric.564616.xyz | bash
```

安装和更新是同一条命令：第一次运行进入安装向导；已经安装过时直接更新到最新版本，沿用原来的设置，完成后自动重启 Spotify。

有新版本时，Spotify 播放栏的歌词按钮上会弹出提示，点开可以看到更新内容和这条命令（已自动复制）。只会安装正式发布的版本（[Releases](https://github.com/dibin666/spotify-patch-lyric/releases)）。

> Windows 不支持 Microsoft Store 版 Spotify。

<details>
<summary>短域名打不开时</summary>

```powershell
irm https://raw.githubusercontent.com/dibin666/spotify-patch-lyric/main/install.ps1 | iex
```

```bash
curl -fsSL https://raw.githubusercontent.com/dibin666/spotify-patch-lyric/main/install.sh | bash
```

</details>

## 使用方式

| 方式 | 说明 |
| --- | --- |
| 云端服务器 | 多设备共享匹配（默认） |
| 纯本地 | 不连接任何远程服务器 |

## 命令

安装后可以在终端使用 `spot-lyric`（Windows 需要打开新的 PowerShell 窗口）：

| 操作 | 命令 |
| --- | --- |
| 更新 | `spot-lyric` |
| 重新设置 | `spot-lyric setup` |
| 状态 | `spot-lyric status` |
| 还原 Spotify | `spot-lyric restore` |
| 卸载 | `spot-lyric uninstall` |

纯本地一步安装：`curl -fsSL https://lyric.564616.xyz | bash -s -- --mode local -y`。更多选项见 `spot-lyric help-patch`；在仓库目录中也可以直接运行 `./patch.sh`（Windows 为 `patch.cmd`）。

本地服务程序（spot-lyric-server）只在选择「纯本地」时才下载或编译。

## 自建服务器（可选）

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
bash tests/patch_test.sh && bash tests/install_test.sh
```

发布：修改 `VERSION`，在 `CHANGELOG.md` 写上这个版本的更新说明（每条不超过 10 个字），推送后 CI 发布 Release，正文就是这一节。

安装 / 更新入口（短域名）是 `worker/` 里的 Cloudflare Worker：`cd worker && npx wrangler deploy`。
[Linux DO](https://linux.do)
