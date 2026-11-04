# Spotify Android 歌词注入 — 完整逆向分析与字段映射

> 基线:`com.spotify.music` **9.2.0.26**(versionCode `148373686`,APKMirror id `16936461`,base.apk 含 15 个 dex,arm64-v8a)
> 分析方法:jadx 全量反编译 + dex class_def/interface 表直接解析(找回 jadx 漏反编译的类)
> 用途:LSPosed 模块注入官方歌词管道的适配基线。`p.xxx` 混淆名逐版本变化,适配新版本按**第 8 节指纹**重新定位。

---

## 1. 完整数据流(已逐环验证)

```
PlayerState ──────────────────────────────────────────────
  playerStateFlowable : Flowable<PlayerState>
  track()→ContextTrack{uri, metadata{title,artist_name,album_title,
    image_url,has_lyrics,...}}, positionAsOfTimestamp(), duration(),
    isPaused(), playbackSpeed(), playbackId()

              ┌─ NPV 歌词卡片 ─────────────────────────────┐
              │ m3e0 (LoadLyricsFromPlayerStateUseCaseImpl) │
              │   mapPlayerState:                           │
              │     bhf0.a(track)=true → h3e0(uri,playId)   │
              │     else → i3e0.a(空态)                     │
              │   → khf0 effect(trackUri,lang,?,a9h预取)    │
              │   → lnf0.d(uri, lang, dhf0, str3)           │
              │     (j2e0: 与 Single.timer(1000) zip)       │
              │   → ukf0 状态 → Compose 渲染(pxd0):         │
              │     rkf0=全屏态(zqf0/FULLSCREEN)            │
              │     tkf0=预览态(crf0, SELECTION)            │
              │     skf0=空态(brf0, SELECTION)              │
              └─────────────────────────────────────────────┘
              ┌─ 全屏歌词页 ────────────────────────────────┐
              │ LyricsFullscreenPageActivity (classes9.dex) │
              │   Intent extras → wjf0(bool,ofm0,int)      │
              │   umf0 (Mobius) → rkm1 effect → wgf0        │
              │   → onf0.b(trackUri, lang)                  │
              └─────────────────────────────────────────────┘
              ┌─ 分享卡/离线下载 ───────────────────────────┐
              │ q7i0 / p1v0 / qmf0 → onf0.b(trackUri, lang) │
              └─────────────────────────────────────────────┘
                          ▼
┌─ 服务接口 onf0 { Single a(String); Single b(String,String) } ─┐
│ 实现 1: itf0 (v3, classes8)                                   │
│   field a = ftf0 (Retrofit)                                   │
│   b(uri,lang): y6b1(uri).e=trackId                            │
│     → ftf0.b(trackId, jo4.a()=vocalRemoval,                   │
│              m980.i()=clientLang, isPreview)                  │
│     → .map(eh10.N0=rtf0) → Single<a9h>                        │
│   a(uri): → ftf0.a(trackId, lang) [download 端点]             │
│ 实现 2: pnf0 (v2, classes2)                                   │
│   field a = ygf0 (Retrofit v2, ColorLyricsResponse)           │
│   b(uri,lang): → ygf0.a(trackId,vocalRm,lang,preview)         │
│     [@GET color-lyrics/v2/track/{id}] → .map(f610.Z=b9h)      │
│   a(uri): → ygf0.b(trackId,lang) [v2 download 端点]           │
│ ⚠ 入参是完整 spotify:track: URI,y6b1=SpotifyUri 解析器        │
└──────────────────────────────────────────────────────────────┘
                          ▼
┌─ 仓库 lnf0 (classes2, 被 m3e0/NPV/DB 使用) ────────────────────┐
│ field d = onf0(上面两个实现之一,由 rm4.b() 旗标选 v2/v3)      │
│ c(uri, lang): !flag → d.b(uri,lang) 直通                      │
│               flag → DB 链路 (flatMap → Room)                 │
│ b(uri, str2, dhf0, str3): zip(c, DB读).doOnSuccess(写DB)      │
│ d(uri, lang, dhf0, str3): NPV 用的入口(j2e0 调用处)          │
│ a(ang1, onm): 协程挂起版                                      │
│ DB: pmf0(iff0 DAO)→lyrics_entities;ang1=(3×String 缓存键)    │
└──────────────────────────────────────────────────────────────┘
```

### 注入点最终结论

**主注入点:`onf0.b(String spotifyTrackUri, String clientLanguage)`**
- 覆盖:全屏页、NPV 网络路径、分享卡、离线下载
- 实现类:`itf0`(v3)+ `pnf0`(v2)——**两个都要 hook**(或用接口方法 hook 实现类)
- 返回:`Single<a9h>`,我们构造 a9h → `Single.just(...)`
- `onf0.a(String uri)` = 下载/离线变体,同样处理

**辅助注入点:`lnf0.b/d/c`** — NPV 卡片路径 + Room 缓存(若 hook onf0 即可覆盖网络路径;DB 命中会短路,见下)

**入口开闸(缺一不可)**:
| 位置 | 手段 |
|---|---|
| `bhf0.a(ContextTrack)` | 直接 hook 返回 true;或开 `enable_has_lyrics_check_bypass`(`bhf0` 内部:`metadata.has_lyrics=="true"` 或 `bypass && uri∈spotify:track: && !podcast子集`) |
| `aey0.c(key,bool)` | 旗标统一覆写(见 §7) |
| `has_lyrics` 元数据 | 可选,bhf0 短路更快 |
| `fef0.h` capStatus | 构造 a9h 时给 2(UNCAPPED) |
| `eef0` | hasVocalRemoval,给 false |

---

## 2. Proto 层(网络协议)

### v3 — `color-lyrics/v3`(当前默认)

`com.spotify.lyrics.serviceretrofit.proto.v3.LyricsWrapperResponse`

| field# | 字段 | getter | 说明 |
|---|---|---|---|
| 1 | lyrics_ : LyricsV3Response | o() | 歌词本体 |
| 2 | hasVocalRemoval_ : bool | n() | 伴唱功能标志 |

`LyricsV3Response`

| field# | 字段 | getter | 说明 |
|---|---|---|---|
| 1 | syncType_ : enum **htf0** | s() | 0=UNSYNCED 1=LINE_SYNCED 2=RICH_SYNCED(逐字) |
| 2 | lines_ : list\<LyricsLine\> | q() | 歌词行 |
| 3 | previewLines_ : list\<LyricsLine\> | p() | 预览行 |
| 4 | provider_ : Provider | r() | o()=lyricsId, getName(), getDisplayName() |
| 5 | translation_ : Translation | t() | {language:Language(field1), lines:List\<String\>(field2)} |
| 6 | language_ : Language | p() | n()=code, p()=isRtl |
| 7 | capStatus_ : enum **gtf0** | n() | 0=NONE 1=UNCAPPED 3=CAPPED |

`LyricsLine`:`n()`=startTimeMs(1), `p()`=words(3), `o()`=syncData(4);endTimeMs(2) 存在但领域层丢弃
`SyncData`:`o()`=startTimeMs(1), `n()`=numChars(3);endTimeMs(2) 存在但领域层只用 (start,numChars)

### v2 — 旧端点(`ygf0` 服务)

`ColorLyricsResponse`:`p()`=LyricsResponse, `n()`=ColorData, `o()`=hasVocalRemoval
`ColorData`:`n()`=background(int ARGB), `q()`=text, `p()`=highlightText

`LyricsResponse`

| field# | 字段 | getter | 说明 |
|---|---|---|---|
| 1 | syncType_ : enum **nnf0** | v() | 0=UNSYNCED 1=LINE_SYNCED 2=SYLLABLE_SYNCED |
| 2 | lines_ | r() | LyricsLine{startTimeMs=1, words=2, syllables=3{startTimeMs=1,numChars=2}} |
| 3/4/5 | provider_/providerLyricsId_/providerDisplayName_ | s()/u()/t() | |
| 7 | syncLyricsUri_ | — | |
| 9 | alternatives_ | n() | **翻译**:Alternative{language=1, lines:List\<String\>=2, isRtl=3} |
| 10/11 | language_/isRtlLanguage_ | getLanguage()/q() | |
| 14 | capStatus_ : enum **mnf0** | o() | 同 gtf0 |
| 19 | translationLanguages_ | w() | 可用翻译语言码 → fef0.i |

---

## 3. 领域模型(构造目标,均 Parcelable)

### `a9h` — Lyrics 顶层(classes9 等多 dex)

已验证的三个构造(字段仅 `fef0 a` + `bff0 b`):
```java
a9h(List<aef0> lines, int syncType, List<def0> translations,   // 主构造(我们的目标)
    String lang, boolean isRtl, bef0 provider,
    eef0 vocalRemoval, int capStatus, List translationLangs,
    bff0 colors)
a9h(fef0 data, bff0 colors)                                    // 双参
a9h(ArrayList, int, List, String, boolean, bef0, eef0, int,    // 默认参数合成构造
    bff0, int defaultFlags)                                    //   (rtf0 走这个)
// Kotlin 默认参数:lines=[] syncType=1 translations=[] lang=""
//   isRtl=false provider=bef0("","","") vocalRemoval=eef0(false)
//   capStatus=1 translationLangs=[] colors=默认五色
```

### `fef0` — LyricsData

| # | 字段 | 类型 | 语义 |
|---|---|---|---|
| a | List\<aef0\> | 歌词行 |
| b | int | **syncType**:1=无同步 2=逐行 3=逐字(UNSYNCED→1, LINE→2, RICH/SYLLABLE→3, UNRECOGNIZED→1) |
| c | List\<def0\> | 翻译列表(v3 最多 1 个;v2 alternatives 全量)。**非空时 UI 显示双语** |
| d | String | 语言码(BCP47) |
| e | boolean | isRtl |
| f | bef0 | 来源(provider) |
| g | eef0 | **hasVocalRemoval**(≠配额!给 false) |
| h | int | **capStatus**:1=NONE/未知 2=UNCAPPED 3=CAPPED |
| i | List | 可用翻译语言码列表 |

### `aef0` — 行:`(long startMs, String words, ArrayList<cef0> syncWords)`
无 endTime——下行 start 即结束。

### `cef0` — 逐字:`(int startTimeMs, int numChars)`
按行内顺序相接;我们的 wsync/ytlrc 每词 → cef0(词首 ms, 词字符数)。
**行文本必须等于各 numChars 之和**(空格计入)。

### `def0` — 翻译:`(String language, List<String> lines, boolean isRtl)`
与主行一一对应的纯文本。

### `bef0` — 来源:`(String id, String name, String displayName)`
v3:(lyricsId,name,displayName);v2:(providerLyricsId,provider,providerDisplayName)

### `eef0` — `(boolean hasVocalRemoval)`

### `bff0` — 颜色:`(int a,int b,int c,int d,int e, boolean f)`

| 槽 | v3 默认(rtf0 硬编码) | v2(ColorData) | 语义推断 |
|---|---|---|---|
| a | FF353535 | background | 背景 |
| b | FF565656 | background | 背景次色 |
| c | FFFFFFFF | highlightText | 已唱/高亮文本 |
| d | FFCDCDCD | text | 普通文本(灰) |
| e | FF1ED760 | highlightText | 逐字填充/强调 |
| f | true | false | 动态/默认配色标志(实机验证) |

`enable_dynamic_colors` 时客户端从封面取色覆盖。

## 4. UI/状态层

| 类 | 结构 | 语义 |
|---|---|---|
| `ukf0` | interface,`a()→a9h` | 歌词状态接口 |
| `tkf0` | (a9h, int, bool) | 预览/选中态 → crf0(int,bool) |
| `rkf0` | (a9h) | 全屏态 → zqf0 |
| `skf0` | (a9h) | 空态 → brf0 |
| `vkf0`/`qkf0` | wkf0 实现 | 其他状态包装 |
| `wkf0` | interface | ukf0 父接口 |
| `dhf0` | enum | 显示模式:FULLSCREEN / SELECTION |
| `khf0` | (str a,str b,str c,a9h d) | NPV 加载 effect;d=预取歌词(可为 null) |
| `ung1`/`vng1` | (a9h) | 加载成功事件包装 |
| `gef0` | (a9h,trackUri,id,title,artists,imageUrl) | 全屏页组装数据 |
| `h3e0`/`i3e0`/`j3e0`/`e3e0` | (uri,playId)/单例 | m3e0 的 LocalPlayerState 状态机 |
| `wjf0` | (bool, ofm0, int) Parcelable | 全屏 Activity Intent 参数 |
| `ofm0` | enum | PLAYBACK / SELECTION |
| `xkf0` | (wkf0,bff0,str×4,nkf0,str,bool×2,aog1,bool,jkf0,ob30,bool,bool,bool,tm21) | NPV 歌词卡 ViewModel;b=bff0 颜色,k=aog1(∈xng1 且 fef0.c 非空→双语模式) |
| `yqf0`/`erf0`/`crf0`/`vhc0`/`brf0`/`zqf0` | Compose props | 渲染配置 |
| `sqs0` | `key_selected_lyrics_translation_language` | 用户翻译语言偏好(SharedPrefs) |
| `bhf0` | `a(ContextTrack)→bool` | has_lyrics 检查(metadata.has_lyrics ∥ bypass&&track&&!episode) |
| `m3e0` | NPV UseCase | PlayerState→LocalPlayerState→lnf0.d→ukf0 |
| `umf0` | Mobius 控制器 | 全屏页:注册 wgf0(rkm1→onf0.b→alm1/zkm1) |
| `wgf0`/`vgf0` | EffectHandler | 执行加载 |
| `q7i0` | onf0 消费者 | ga01 缓存路径 + onf0.b → j7i0(a9h) |
| `y6b1` | SpotifyUri 解析 | `.e`=entity id(trackId) |
| `m980` | `i()→String` | 客户端语言 |
| `jo4`/`rm4`/`qg4`/`pg4` | pdy0 实现 | 旗标持有类 |
| `ang1` | (String×3) | lnf0 缓存键(trackId+lang+?) |
| `pmf0` | (iff0 DAO, Scheduler) | Room 访问 |
| `iff0`/`hff0` | DAO | `lyrics_entities` SQL:`SELECT * FROM lyrics_entities WHERE track_id = ?` |
| `n740` | mapper | `(a9h)→gef0` 组装(trackUri/title/artist/image) |

## 5. Room 表(lyrics_entities)

```sql
CREATE TABLE IF NOT EXISTS `lyrics_entities` (
  `track_id` TEXT NOT NULL, `lines` TEXT NOT NULL,
  `syncStatus` TEXT NOT NULL, `translations` TEXT NOT NULL,
  `language` TEXT NOT NULL, `isRTL` INTEGER NOT NULL,
  `provider` TEXT NOT NULL, `colors` TEXT NOT NULL,
  `vocalRemovalStatus` TEXT NOT NULL, PRIMARY KEY(`track_id`))
```

`lines`/`translations`/`provider`/`colors` 为 **kotlinx.serialization JSON**(序列化器 `*ff0` 系列:`jff0/pff0/sff0/yff0/mff0/vff0`);`syncStatus`/`vocalRemovalStatus` 为枚举字符串(`com.spotify.lyrics.data.model.Lyrics.SyncStatus` — 该类本体在动态模块,枚举名保留)。
⚠ 直写 DB 可行但 JSON schema 需按序列化器 descriptor 再验证 — 只作备选路径。

## 6. 动态模块说明

dex class_def 验证结果:
- `LyricsFullscreenPageActivity`、`bhf0`、`caq`(Dagger SwitchingProvider)、`itf0`、`pnf0` **都在 base dex**(classes2/5/7/8/9),只是部分类 jadx 未反编译 — `--single-class` 可取
- `com.spotify.lyrics.data.model.Lyrics`、`npvelementsimpl.usecase.LoadLyricsFromPlayerStateUseCaseImpl` 类名在 @Metadata/异常串中出现但**类本体不在 base**(`android-lyrics-*` 特性模块,Play 动态下发)
- 不影响注入:我们的构造目标 `a9h`/`fef0` 等及全部管道都在 base

## 7. 特性旗标(`aey0` 统一覆写点)

`aey0` 签名:`c(String,bool)→bool`、`a(String,Enum)→Enum`、`b(int,int,int,String)→int`

| key | 建议 |
|---|---|
| android-feature-lyrics-npvelements:lyrics_entry_point_enabled | **true** |
| android-feature-lyrics-npvelements:enable_lyrics_multilanguage | true |
| android-feature-lyrics-npvelements:lyrics_entry_point_button_v2_enabled | 实测 |
| android-feature-lyrics-npvelements:shared_npv_lyrics_loading_enabled | true |
| android-feature-lyrics-npvelements:lifecycle_aware_lyrics_fetch_enabled | true |
| android-feature-lyrics-npvelements:lyrics_on_car_player_enabled | 按需 |
| android-libs-lyrics:enable_v3_lyrics_endpoint | **决定走 itf0 还是 pnf0** |
| android-libs-lyrics:enable_lyrics_multilanguage | true |
| android-libs-lyrics:enable_bcp47_client_language | true |
| android-feature-lyrics-repository:enable_dynamic_colors | true |
| android-feature-lyrics-repository:enable_has_lyrics_check_bypass | **true**(免改元数据) |
| android-feature-lyrics-repository:enable_translated_lyrics_request_sharing | true |
| android-feature-lyrics-repository:clear_cache_on_trim_enabled | 随意 |
| android-lyrics-fullscreenview:enable_lyrics_multilanguage | true |
| android-lyrics-fullscreenview:enable_lyrics_fullscreen_from_anywhere | true |
| android-lyrics-offline-impl:lyrics_offline_enabled | **false 更安全**(防 DB 缓存盖住我们的注入) |
| android-lyrics-textelement:stable_highlight_colour_enabled 等 | 保持默认 |

**免费用户**:歌词路径中未见 ProductState/premium 检查 —— 门槛 = `bhf0` 判定 + capStatus(我们给 UNCAPPED)+ 旗标。

## 8. 版本适配指纹(重混淆后定位)

| 目标 | 指纹 |
|---|---|
| `onf0` | interface;恰两方法返 `Single`,签名 `(String)`、`(String,String)`;被 `lnf0`/Mobius handler 持有 |
| `itf0`/`pnf0` | `implements onf0`(dex class_def 接口表可查);itf0 字段含 `ftf0`,pnf0 字段含 `ygf0`;`b()` 内 `new y6b1(uri,false)` 解析 |
| `ftf0`/`ygf0` | Retrofit interface;注解常量 `color-lyrics/v3/track/{trackId}` / `application/protobuf` |
| `rtf0`/`b9h` | 抽象类静态映射 `→a9h`;含 `FF1ED760`/`FF353535`/`FF565656`/`FFCDCDCD` 常量串 |
| `eh10`/`yb10`/`f610` | 巨型多接口 Function;`apply` 分支调 rtf0/b9h |
| `a9h` | Parcelable;(fef0,bff0) 两字段 + 10 参便捷构造 |
| `fef0` | Parcelable;`List,int,List,String,boolean,bef0,eef0,int,List` |
| `aef0`/`cef0`/`def0`/`bef0`/`eef0`/`bff0` | Parcelable;字段型 `(long,String,ArrayList)`/`(int,int)`/`(String,List,boolean)`/`(String×3)`/`(boolean)`/`(int×5,boolean)` |
| `lnf0` | 持有 onf0 字段;方法 `(String,String)→Single` `(String,String,dhf0,String)→Single`;含 `lyrics_entities` SQL |
| `bhf0` | `a(ContextTrack)→bool`;读 `has_lyrics` 元数据 + `l4o1.W`(uri 前缀 `spotify:track:`) |
| `m3e0` | `mapPlayerState(LocalPlayerState, PlayerState)` Kotlin 签名在 @Metadata 可见;字段含 lnf0+bhf0 |
| `ukf0`/`tkf0`/`rkf0`/`skf0` | interface `a()→a9h` 及实现;渲染处 `instanceof` 三分支 + Compose |
| `aey0` | 大量 `.c("android-feature-*:*", false)` 调用点;`models()` 产出 `fpb` 列表 |
| `wgf0`/`umf0` | Mobius `EffectHandler`;`rkm1` effect → onf0.b |
| proto 类 | `com.spotify.lyrics.serviceretrofit.*` 未混淆,直接反射 builder/parseFrom |
| `ScrollCardType` | `com.spotify.nowplaying.scroll.ScrollCardType` 未混淆,`.LYRICS` |
| Dagger provider `caq` | classes2 SwitchingProvider(jadx 易漏);运行时不必解析 — hook 实现类即可 |

**适配流程建议**:模块启动时按指纹扫描(包 `Lp` + 字段/方法签名 + 常量串)生成「类名→角色」表,按 Spotify versionCode 缓存 + 服务端下发兜底;指纹冲突时逐候选 hook 验证返回值类型。

## 9. 我们的歌词 → Spotify 模型转换

| 输入 | 目标 | 规则 |
|---|---|---|
| 逐行 LRC | `aef0(startMs,text,[])` + `fef0.b=2` | 按时间排序;无 endTime |
| 逐字 wsync/ytlrc | `aef0(startMs,整行,[cef0(词首ms,字符数)])` + `fef0.b=3` | numChars 含空格;ΣnumChars=行文本长度 |
| 翻译 tlyric | `def0(lang,[逐行译文],isRtl)`→`fef0.c` | 与主行等长;无译文行给 "" |
| 罗马音 | 同上,lang 自定义(如 `romaji`) | |
| 来源 | `bef0(id,name,displayName)` | displayName 显示在 UI |
| 语言 | `fef0.d`=BCP47,`fef0.e`=RTL | |
| 配额 | `fef0.h=2` | UNCAPPED |
| 伴唱 | `eef0(false)` | |
| 颜色 | `bff0` 默认五色;或开动态取色 | |
| 翻译语言列表 | `fef0.i`=提供的语言码 | |
| 无词曲目 | 返回 `Single.error`/`skf0` | 保持官方降级 |
| 预览行 | v3 proto 层才用;领域层不需要 | |

## 10. 风险与已知问题

- `librootChecker.so` = Ravelin 反欺诈(checkForRoot/isMagiskPresent),打分不拦截;建议 DenyList/Shamiko
- `eef0` = hasVocalRemoval,**capStatus 在 fef0.h** —— 勿混淆
- `LyricsLine.endTimeMs`(proto 有)→ 领域模型丢弃;构造时确保行按时间排序
- 免费用户歌词配额(capStatus)由服务端下发,我们注入时强制 UNCAPPED
- `lyrics_offline_enabled` 若开,DB 命中会短路 onf0 —— 注入期建议关旗标或同时 hook `pmf0`
- 混淆名版本漂移:所有 `p.*` 名仅 9.2.0.26 有效;`com.spotify.*` 库类名相对稳定但也可变
- `onf0` 运行期定位:`XposedHelpers.findClass("onf0")` → 枚举/反射 `lnf0.d`/`umf0` 构造参数拿到实例类;或 hook 两实现类
