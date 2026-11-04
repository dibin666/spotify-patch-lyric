package xyz.spotlyric.mod.data

/**
 * 模块配置键 —— App 侧写、hook 侧经 libxposed remote preferences / BridgeProvider 读。
 */
object Prefs {
    const val NAME = "spotlyric"

    const val ENABLED = "enabled"
    const val FALLBACK_OFFICIAL = "fallback_official"
    const val WORD_SYNC = "word_sync"
    const val TRANSLATION = "translation"
    const val SOURCES = "sources"            // csv: "netease,qq" 顺序即优先级
    const val SERVER_URL = "server_url"
    const val SERVER_MODE = "server_mode"    // off | bindings | relay
    const val OFFSET_MS = "offset_ms"
    const val FLAG_OVERRIDES = "flag_overrides" // 允许覆写旗标

    /* 状态回写(hook 进程 → App 界面) */
    const val ST_ACTIVE = "status_active"
    const val ST_SPOTIFY_VERSION = "status_spotify_version"
    const val ST_TRACK_TITLE = "status_track_title"
    const val ST_TRACK_ARTIST = "status_track_artist"
    const val ST_PROVIDER = "status_provider"
    const val ST_SYNC_TYPE = "status_sync_type"
    const val ST_LINES = "status_lines"
    const val ST_INJECT_COUNT = "status_inject_count"
    const val ST_LAST_ERROR = "status_last_error"
    const val ST_LAST_TIME = "status_last_time"
    const val ST_SERVER_OK = "status_server_ok"

    const val SERVER_OFF = "off"
    const val SERVER_BINDINGS = "bindings"
    const val SERVER_RELAY = "relay"

    const val DEFAULT_SOURCES = "netease,qq"
}

data class ModuleConfig(
    val enabled: Boolean = true,
    val fallbackOfficial: Boolean = true,
    val wordSync: Boolean = true,
    val translation: Boolean = true,
    val sources: List<String> = listOf("netease", "qq"),
    val serverUrl: String = "",
    val serverMode: String = Prefs.SERVER_OFF,
    val offsetMs: Int = 0,
    val flagOverrides: Boolean = true,
)
