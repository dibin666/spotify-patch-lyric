package xyz.spotlyric.mod.module

import android.app.Application
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.util.Log
import io.github.libxposed.api.XposedInterface
import io.github.libxposed.api.XposedModule
import io.github.libxposed.api.XposedModuleInterface.PackageReadyParam
import io.reactivex.rxjava3.core.Single
import io.reactivex.rxjava3.schedulers.Schedulers
import org.json.JSONObject
import xyz.spotlyric.mod.data.ModuleConfig
import xyz.spotlyric.mod.data.Prefs
import xyz.spotlyric.mod.engine.Engine
import xyz.spotlyric.mod.engine.EngineConfig
import xyz.spotlyric.mod.engine.TrackInfo
import java.util.concurrent.ConcurrentHashMap

/* 模块入口:java_init.list 指向此类。
 * 职责:解析类 → 装 hook(onf0 数据注入 + bhf0 入口 + aey0 旗标)→ 引擎取词 → 装配 a9h。 */
class ModuleMain : XposedModule() {

    companion object {
        const val TAG = "SpotLyric"
        const val SPOTIFY = "com.spotify.music"
        const val BRIDGE = "content://xyz.spotlyric.mod.bridge"

        /* 旗标覆写表(键为 RemoteConfig 常量串,不受混淆影响) */
        val FLAG_FORCES = mapOf(
            "android-feature-lyrics-npvelements:lyrics_entry_point_enabled" to true,
            "android-feature-lyrics-npvelements:enable_lyrics_multilanguage" to true,
            "android-feature-lyrics-npvelements:shared_npv_lyrics_loading_enabled" to true,
            "android-feature-lyrics-npvelements:lifecycle_aware_lyrics_fetch_enabled" to true,
            "android-feature-lyrics-repository:enable_dynamic_colors" to true,
            "android-feature-lyrics-repository:enable_has_lyrics_check_bypass" to true,
            "android-feature-lyrics-repository:enable_translated_lyrics_request_sharing" to true,
            "android-libs-lyrics:enable_lyrics_multilanguage" to true,
            "android-libs-lyrics:enable_bcp47_client_language" to true,
            "android-libs-lyrics:enable_common_capping" to true,
            "android-lyrics-fullscreenview:enable_lyrics_multilanguage" to true,
            "android-lyrics-fullscreenview:enable_lyrics_fullscreen_from_anywhere" to true,
            /* 离线缓存会短路我们的注入,默认关掉 */
            "android-lyrics-offline-impl:lyrics_offline_enabled" to false,
        )

        @Volatile var injectCount = 0
    }

    private lateinit var factory: DomainFactory
    private lateinit var roles: SpotifyIndex.Roles
    private var spotify: Context? = null
    /* context 可用前挂起的状态 */
    private val pendingStatus = java.util.concurrent.ConcurrentLinkedQueue<Map<String, Any>>()

    private val tracks = ConcurrentHashMap<String, TrackInfo>(8)
    @Volatile private var lastTrack: TrackInfo? = null
    @Volatile private var cfg = ModuleConfig()

    override fun onPackageReady(param: PackageReadyParam) {
        if (param.packageName != SPOTIFY) return
        try {
            cfg = config()
            SpotifyIndex.persistedJson = readPref(Prefs.ST_RESOLVED_MAP) ?: ""
            roles = SpotifyIndex.resolve(param.applicationInfo, param.classLoader)
            factory = DomainFactory(roles)
            install(param)
            log(Log.INFO, TAG, "spotify ready: ${SpotifyIndex.versionName}(${SpotifyIndex.versionCode}) via ${SpotifyIndex.resolvedFrom}")
            report(mapOf(
                Prefs.ST_ACTIVE to true,
                Prefs.ST_SPOTIFY_VERSION to "${SpotifyIndex.versionName} (${SpotifyIndex.versionCode})".let {
                    if (SpotifyIndex.versionCode == 0L) "? [${ApkVersion.lastError}]" else it },
                Prefs.ST_RESOLVED_FROM to SpotifyIndex.resolvedFrom,
                Prefs.ST_RESOLVED_MAP to SpotifyIndex.pinsJson(roles),
            ))
        } catch (t: Throwable) {
            log(Log.ERROR, TAG, "resolve/install failed", t)
            report(mapOf(Prefs.ST_LAST_ERROR to "resolve: ${t.message}"))
        }
    }

    /* ------------------------------------------------ hooks ---- */

    private fun install(param: PackageReadyParam) {
        runCatching { roles.bhf0?.let { hookBhf(it) } }
            .onFailure { log(Log.WARN, TAG, "hookBhf failed", it) }

        val impls = roles.onf0Impls.ifEmpty { listOfNotNull(roles.lnf0) }
        for (impl in impls) runCatching { hookOnf0(impl) }
            .onFailure { log(Log.WARN, TAG, "hookOnf0(${impl.name}) failed", it) }

        if (cfg.flagOverrides) {
            for (impl in roles.aey0Impls) runCatching { hookFlags(impl) }
            roles.aey0?.takeIf { !it.isInterface }?.let { runCatching { hookFlags(it) } }
        }

        /* lnf0 可能与 onf0 impl 同类(指纹误命中)——已在 impls 中挂钩则跳过 */
        roles.lnf0?.takeIf { it !in roles.onf0Impls }?.let { runCatching { hookLnf0(it) } }

        /* Activity.onCreate 引导:尽早拿到 Application context 供 BridgeProvider 用 */
        runCatching {
            val m = android.app.Activity::class.java.getDeclaredMethod("onCreate", android.os.Bundle::class.java)
            hook(m).intercept { chain ->
                if (spotify == null) {
                    ((chain.thisObject as? android.app.Activity)?.application)?.let { app ->
                        spotify = app
                        log(Log.INFO, TAG, "context acquired via ${chain.thisObject?.javaClass?.simpleName}")
                        flushPending()
                    }
                }
                chain.proceed()
            }
        }.onFailure { log(Log.WARN, TAG, "activity bootstrap hook failed", it) }

        log(Log.INFO, TAG, "hooks: onf0=${roles.onf0Impls.map { it.name }} bhf0=${roles.bhf0?.name} aey0impls=${roles.aey0Impls.map { it.name }}")
    }

    private fun flushPending() {
        while (true) {
            val m = pendingStatus.poll() ?: break
            report(m)
        }
    }

    /* has_lyrics 判定:捕获曲目元数据 + 强制放行 */
    private fun hookBhf(cls: Class<*>) {
        val ctxTrack = Class.forName("com.spotify.player.model.ContextTrack", false, cls.classLoader)
        for (m in cls.declaredMethods) {
            if (m.returnType != Boolean::class.javaPrimitiveType) continue
            if (m.parameterTypes.size != 1 || m.parameterTypes[0] != ctxTrack) continue
            hook(m).intercept { chain ->
                captureTrack(chain.args[0])
                if (cfg.enabled) return@intercept true
                chain.proceed()
            }
        }
    }

    /* onf0 实现:b(uri,lang)/a(uri) —— 歌词数据唯一入口 */
    private fun hookOnf0(cls: Class<*>) {
        for (m in cls.declaredMethods) {
            if (m.name != "b" && m.name != "a") continue
            if (m.parameterTypes.isEmpty() || m.parameterTypes[0] != String::class.java) continue
            hook(m).intercept { chain -> handleLyrics(chain) }
        }
    }

    /* lnf0 仓库:所有 (String,...)→Single 方法(NPV 直走) */
    private fun hookLnf0(cls: Class<*>) {
        val single = Class.forName("io.reactivex.rxjava3.core.Single", false, cls.classLoader)
        for (m in cls.declaredMethods) {
            if (m.returnType != single) continue
            if (m.parameterTypes.isEmpty() || m.parameterTypes[0] != String::class.java) continue
            hook(m).intercept { chain -> handleLyrics(chain) }
        }
    }

    /* 旗标覆写:(String,boolean)→boolean 方法 */
    private fun hookFlags(cls: Class<*>) {
        for (m in cls.declaredMethods) {
            if (m.returnType != Boolean::class.javaPrimitiveType) continue
            if (!m.parameterTypes.contentEquals(arrayOf(String::class.java, Boolean::class.javaPrimitiveType))) continue
            hook(m).intercept { chain ->
                val key = chain.args[0] as? String
                val forced = FLAG_FORCES[key]
                if (forced != null) return@intercept forced
                chain.proceed()
            }
        }
    }

    /* ------------------------------------------------ 注入核心 ---- */

    private fun handleLyrics(chain: XposedInterface.Chain): Any? {
        cfg = config()
        if (!cfg.enabled) return chain.proceed()
        val uri = chain.args[0] as? String ?: return chain.proceed()
        if (!uri.startsWith("spotify:track:")) return chain.proceed()

        val track = tracks[uri] ?: lastTrack?.takeIf { it.uri == uri }
            ?: TrackInfo(uri, trackId(uri), "", emptyList(), "", 0)

        val ours = Single.create<Any> { emitter ->
            try {
                val res = Engine.lyricsFor(track, engineConfig())
                if (res != null && res.lines.isNotEmpty()) {
                    injectCount++
                    report(mapOf(
                        Prefs.ST_PROVIDER to res.displayName,
                        Prefs.ST_SYNC_TYPE to res.syncType.name,
                        Prefs.ST_LINES to res.lines.size,
                        Prefs.ST_INJECT_COUNT to injectCount,
                        Prefs.ST_LAST_TIME to System.currentTimeMillis(),
                    ))
                    emitter.onSuccess(factory.build(res, cfg.translation))
                } else {
                    emitter.onError(NoSuchElementException("no lyrics"))
                }
            } catch (t: Throwable) {
                emitter.onError(t)
            }
        }.subscribeOn(Schedulers.io())

        /* 我们的结果优先;无词/出错时按配置回退官方歌词 */
        return if (cfg.fallbackOfficial) {
            @Suppress("UNCHECKED_CAST")
            val original = chain.proceed() as Single<Any>
            ours.onErrorResumeWith(original)
        } else ours
    }

    private fun trackId(uri: String) = uri.removePrefix("spotify:track:")

    /* ------------------------------------------------ 曲目捕获 ---- */

    private fun captureTrack(ctxTrack: Any) {
        try {
            val cls = ctxTrack.javaClass
            val uri = cls.getMethod("uri").invoke(ctxTrack) as? String ?: return
            @Suppress("UNCHECKED_CAST")
            val meta = cls.getMethod("metadata").invoke(ctxTrack) as? Map<String, String> ?: return
            val artists = (meta["artist_name"] ?: "")
                .split(Regex("[:;/,、]")).map { it.trim() }.filter { it.isNotEmpty() }
            val track = TrackInfo(
                uri = uri, id = trackId(uri),
                title = meta["title"] ?: "",
                artists = artists,
                album = meta["album_title"] ?: "",
                durationMs = meta["duration"]?.toLongOrNull() ?: 0,
                imageUrl = meta["image_url"] ?: "",
                hasLyrics = meta["has_lyrics"].toBoolean(),
            )
            tracks[uri] = track
            lastTrack = track
            report(mapOf(
                Prefs.ST_TRACK_TITLE to track.title,
                Prefs.ST_TRACK_ARTIST to track.artists.joinToString(", "),
            ))
        } catch (_: Throwable) { }
    }

    /* ------------------------------------------------ 配置/状态 ---- */

    private fun readPref(key: String): String? =
        try { getRemotePreferences(Prefs.NAME).getString(key, null) } catch (_: Throwable) { null }

    private fun context(): Context? {
        spotify?.let { return it }
        /* currentApplication 是隐藏 API,新系统反射被禁;主要靠 Activity.onCreate 引导 */
        return try {
            val at = Class.forName("android.app.ActivityThread")
            val app = at.getMethod("currentApplication").invoke(null) as? Application
            app?.also { spotify = it; flushPending() }
        } catch (_: Throwable) { null }
    }

    private fun config(): ModuleConfig {
        /* remote prefs(libxposed 官方跨进程偏好,框架同步模块 App 的 shared_prefs) */
        try {
            val p = getRemotePreferences(Prefs.NAME)
            return ModuleConfig(
                enabled = p.getBoolean(Prefs.ENABLED, true),
                fallbackOfficial = p.getBoolean(Prefs.FALLBACK_OFFICIAL, true),
                wordSync = p.getBoolean(Prefs.WORD_SYNC, true),
                translation = p.getBoolean(Prefs.TRANSLATION, true),
                sources = (p.getString(Prefs.SOURCES, null) ?: Prefs.DEFAULT_SOURCES).split(","),
                serverUrl = p.getString(Prefs.SERVER_URL, null) ?: "",
                serverMode = p.getString(Prefs.SERVER_MODE, null) ?: Prefs.SERVER_OFF,
                offsetMs = p.getInt(Prefs.OFFSET_MS, 0),
                flagOverrides = p.getBoolean(Prefs.FLAG_OVERRIDES, true),
            )
        } catch (_: Throwable) { }
        /* 兜底:BridgeProvider call */
        try {
            val b: Bundle? = context()?.contentResolver?.call(Uri.parse(BRIDGE), "config", null, null)
            if (b != null) {
                return ModuleConfig(
                    enabled = b.getBoolean(Prefs.ENABLED, true),
                    fallbackOfficial = b.getBoolean(Prefs.FALLBACK_OFFICIAL, true),
                    wordSync = b.getBoolean(Prefs.WORD_SYNC, true),
                    translation = b.getBoolean(Prefs.TRANSLATION, true),
                    sources = (b.getString(Prefs.SOURCES) ?: Prefs.DEFAULT_SOURCES).split(","),
                    serverUrl = b.getString(Prefs.SERVER_URL) ?: "",
                    serverMode = b.getString(Prefs.SERVER_MODE) ?: Prefs.SERVER_OFF,
                    offsetMs = b.getInt(Prefs.OFFSET_MS, 0),
                    flagOverrides = b.getBoolean(Prefs.FLAG_OVERRIDES, true),
                )
            }
        } catch (_: Throwable) { }
        return ModuleConfig()
    }

    private fun engineConfig() = EngineConfig(
        wordSync = cfg.wordSync, translation = cfg.translation,
        sources = cfg.sources, serverUrl = cfg.serverUrl, serverMode = cfg.serverMode,
        offsetMs = cfg.offsetMs.toLong(),
    )

    /** 状态回写:BridgeProvider.call 为准(hook 侧 remote prefs 是只读的,写了也静默丢);
        context 未就绪时挂起,Activity.onCreate 引导后 flush */
    @Volatile private var statusErrLogged = false
    private fun report(map: Map<String, Any>) {
        var sent = false
        val ctx = context()
        /* 主通道:显式组件广播,不受包可见性限制 */
        try {
            ctx?.sendBroadcast(android.content.Intent("xyz.spotlyric.mod.STATUS")
                .setComponent(android.content.ComponentName("xyz.spotlyric.mod", "xyz.spotlyric.mod.data.StatusReceiver"))
                .putExtra("json", JSONObject(map).toString()))
            sent = ctx != null
        } catch (t: Throwable) {
            if (!statusErrLogged) { statusErrLogged = true; log(Log.WARN, TAG, "status broadcast failed", t) }
        }
        /* 辅:provider call(部分环境可见) */
        if (!sent) try {
            ctx?.contentResolver?.call(Uri.parse(BRIDGE), "status", JSONObject(map).toString(), null)
                ?.let { sent = true }
        } catch (_: Throwable) { }
        if (!sent) {
            pendingStatus.offer(map)
            while (pendingStatus.size > 20) pendingStatus.poll()
        } else {
            flushPending()
        }
    }
}
