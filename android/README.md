# SpotLyric — Spotify Android 歌词注入模块

LSPosed(libxposed API 102)模块:在 Spotify 原生歌词管道注入来自网易云/QQ/自建服务器的歌词,
NPV 卡片与全屏页均以原生样式渲染(含逐字卡拉OK与译文)。

## 原理(配合 docs/android/field-mapping-9.2.0.26.md)

```
bhf0.a(ContextTrack)        has_lyrics 判定 → 强制 true(顺带捕获曲目元数据)
        ↓
onf0.b(uri,lang)/a(uri)     Retrofit 取词入口(itf0=v3 / pnf0=v2)
        ↓ 我们的 Single:引擎取词 → 反射装配 a9h
        ↓                    失败回退官方(可关)
a9h → fef0 → NPV Compose 卡片 / LyricsFullscreenPageActivity
```

另覆写 `aey0` 旗标读取(RemoteConfig key 不混淆)强制开 lyrics 相关开关、关离线缓存短路。

## 结构

| 路径 | 作用 |
|---|---|
| `module/ModuleMain` | 入口(java_init.list):装 hook、配置、状态上报 |
| `module/SpotifyIndex` | 类定位:versionCode 固定表 → dex 指纹扫描兜底 |
| `module/DomainFactory` | LyricsResult → a9h 反射装配 |
| `module/ApkVersion` | 无 Context 解析 APK 二进制 manifest 取版本 |
| `engine/` | core.js 的 Kotlin 移植:TextNorm/Matcher/Lrc/Providers/Engine(纯 JVM,App 内可直接自测) |
| `data/` | ModuleConfig + BridgeProvider(跨进程配置/状态) |
| `ui/MainActivity` | Compose 设置页:开关、词源、服务器、偏移、引擎自测 |

## 构建

```bash
echo "sdk.dir=<Android SDK>" > local.properties
gradle :app:assembleDebug   # 输出 app/build/outputs/apk/debug/app-debug.apk
```

依赖:AGP 8.7.3 / Kotlin 2.0.21 / libxposed 102(compileOnly)/ rxjava3(compileOnly,宿主已含)。
proguard 已配置 `-adaptresourcefilecontents META-INF/xposed/java_init.list`。

## 安装

1. 安装 APK,LSPosed 管理器内启用,作用域勾选 `com.spotify.music`,重启 Spotify。
2. App 内查看"已注入"状态;配置实时生效(每次取词重读 remote prefs)。

## 适配新版本

Spotify 更新混淆名漂移时:
1. 新版本反编译,对照 `docs/android/field-mapping-*.md` §8 指纹重新定位。
2. 在 `SpotifyIndex.PINNED` 增加一行新 versionCode 映射。
3. 无固定表时自动走 dex 指纹扫描(慢几秒,仅首启)。

## 已知边界

- `onf0.b` 在 Spotify 进程内直接 HTTP;`server_mode=relay` 时请求经自建服务器中转。
- 逐字歌词来自网易云 yrc(行内 `[ms,dur](wMs,wDur,0)`);QQ 端点返回 LRC+trans。
- `bhf0` 未命中时曲目元数据缺失,搜索查询退化为仅 trackId(bindings 模式仍可用)。
