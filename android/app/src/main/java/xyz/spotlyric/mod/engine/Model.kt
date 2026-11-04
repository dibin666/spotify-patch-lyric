package xyz.spotlyric.mod.engine

/** 曲目(取自 Spotify ContextTrack 元数据) */
data class TrackInfo(
    val uri: String,
    val id: String,            // spotify:track:XXX → XXX
    val title: String,
    val artists: List<String>,
    val album: String,
    val durationMs: Long,
    val imageUrl: String = "",
    val hasLyrics: Boolean = false,
)

/** 上游候选曲目 */
data class Candidate(
    val provider: String,      // netease | qq | server
    val id: String,
    val mid: String = "",      // qq songmid
    val title: String,
    val album: String = "",
    val durationMs: Long = 0,
    val artists: List<String> = emptyList(),
    val aliases: List<String> = emptyList(),
) {
    /* 打分输出 */
    var eligible = false
    var score = 0.0
    var deltaMs = -1L
    var titleScore = 0.0
    var artistScore = 0.0
    var albumScore = 0.0
    var durationScore = 0.0
    var reason = ""
}

data class Word(
    val text: String,
    val startMs: Long,
    val endMs: Long,
)

data class LyricLine(
    val text: String,
    val startMs: Long,
    val endMs: Long,
    val translatedText: String? = null,
    val words: List<Word> = emptyList(),
)

/** 解析/匹配完成、可注入的歌词 */
data class LyricsResult(
    val provider: String,          // 来源标记(显示用)
    val providerId: String = "",   // 上游曲目 id
    val providerName: String = "",
    val displayName: String = "",
    val language: String = "",
    val isRtl: Boolean = false,
    val syncType: SyncType,
    val lines: List<LyricLine>,
    val translationLangs: List<String> = emptyList(),
) {
    enum class SyncType(val domainValue: Int) {
        UNSYNCED(1), LINE(2), WORD(3)
    }
}

/** 配置快照(hook 侧从桥/远端偏好读取) */
data class EngineConfig(
    val wordSync: Boolean = true,
    val translation: Boolean = true,
    val sources: List<String> = listOf("netease", "qq"),
    val serverUrl: String = "",
    val serverMode: String = "off",
    val offsetMs: Long = 0,
    val http: Http? = null,          // null=直连;否则经服务器 relay
)
