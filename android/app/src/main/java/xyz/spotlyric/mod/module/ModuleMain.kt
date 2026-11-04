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

    private val tracks = ConcurrentHashMap<String, TrackInfo>(8)
    @Volatile private var lastTrack: TrackInfo? = null
    @Volatile private var cfg = ModuleConfig()

    override fun onPackageReady(param: PackageReadyParam) {
        if (param.packageName != SPOTIFY) return
        val (vc, vn) = ApkVersion.read(param.applicationInfo.sourceDir)
        log(Log.INFO, TAG, "spotify ready: $vn($vc)")
        try {
            cfg = config()
            roles = SpotifyIndex.resolve(param.applicationInfo, param.classLoader)
            factory = DomainFactory(roles)
            install(param)
            report(mapOf(
                Prefs.ST_ACTIVE to true,
                Prefs.ST_SPOTIFY_VERSION to "$vn ($vc)",
            ))
        } catch (t: Throwable) {
            log(Log.ERROR, TAG, "resolve/install failed", t)
            report(mapOf(Prefs.ST_LAST_ERROR to "resolve: ${t.message}"))
        }
    }

    /* ------------------------------------------------ hooks ---- */

    private fun install(param: PackageReadyParam) {
        roles.bhf0?.let { hookBhf(it) }

        val impls = roles.onf0Impls.ifEmpty { listOfNotNull(roles.lnf0) }
        for (impl in impls) hookOnf0(impl)

        if (cfg.flagOverrides) {
            for (impl in roles.aey0Impls) hookFlags(impl)
            /* aey0 本身是具体类(非接口)时直接挂 */
            roles.aey0?.takeIf { !it.isInterface }?.let { hookFlags(it) }
        }

        roles.lnf0?.let { hookLnf0(it) }

        log(Log.INFO, TAG, "hooks: onf0=${roles.onf0Impls.map { it.name }} bhf0=${roles.bhf0?.name} aey0impls=${roles.aey0Impls.map { it.name }}")
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

    private fun context(): Context? {
        spotify?.let { return it }
        return try {
            val at = Class.forName("android.app.ActivityThread")
            val app = at.getMethod("currentApplication").invoke(null) as? Application
            app?.also { spotify = it }
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

    /** 状态回写:remote prefs 为主(无需 Context),BridgeProvider 为辅 */
    private fun report(map: Map<String, Any>) {
        try {
            val p = getRemotePreferences(Prefs.NAME)
            val e = p.edit()
            for ((k, v) in map) when (v) {
                is Boolean -> e.putBoolean(k, v)
                is Int -> e.putInt(k, v)
                is Long -> e.putLong(k, v)
                else -> e.putString(k, v.toString())
            }
            e.apply()
        } catch (_: Throwable) { }
        try {
            context()?.contentResolver?.call(Uri.parse(BRIDGE), "status", JSONObject(map).toString(), null)
        } catch (_: Throwable) { }
    }
}
