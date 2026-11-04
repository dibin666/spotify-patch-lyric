package xyz.spotlyric.mod.engine

/* 歌词引擎:共享库 → 上游匹配 → 解析 → 结果。core.js Engine 的精简移植。 */
object Engine {

    private const val CACHE_MAX = 50
    private const val NEG_TTL = 600_000L   // 未命中负缓存 10 分钟

    private val cache = object : LinkedHashMap<String, LyricsResult>(CACHE_MAX, 0.75f, true) {
        override fun removeEldestEntry(e: Map.Entry<String, LyricsResult>) = size > CACHE_MAX
    }
    private val negative = HashMap<String, Long>()

    var lastError: String = ""
        private set

    @Volatile var serverOk: Boolean? = null
        private set

    private fun httpFor(cfg: EngineConfig): Http =
        if (cfg.serverMode == "relay" && cfg.serverUrl.isNotEmpty())
            Http { r -> Net.viaRelay(cfg.serverUrl, r) }
        else Http { r -> Net.execute(r) }

    /** 主入口:按曲目取词;null=无结果 */
    @Synchronized
    fun lyricsFor(track: TrackInfo, cfg: EngineConfig): LyricsResult? {
        val key = track.id
        if (key.isEmpty()) return null
        cache[key]?.let { return it }
        val neg = negative[key]
        if (neg != null && System.currentTimeMillis() - neg < NEG_TTL) return null

        val http = httpFor(cfg)
        val result = try {
            run(track, cfg, http)
        } catch (e: Exception) {
            lastError = e.message ?: e.javaClass.simpleName
            null
        }
        if (result != null) {
            val shifted = applyOffset(result, cfg.offsetMs)
            cache[key] = shifted
            negative.remove(key)
            return shifted
        }
        negative[key] = System.currentTimeMillis()
        return null
    }

    private fun run(track: TrackInfo, cfg: EngineConfig, http: Http): LyricsResult? {
        /* 1) 服务端共享匹配库 */
        if (cfg.serverMode == "bindings" && cfg.serverUrl.isNotEmpty()) {
            try {
                val hit = ServerProvider.fetchBinding(http, cfg.serverUrl, track.id)
                serverOk = true
                if (hit != null) {
                    val (res, remoteOffset) = hit
                    return if (remoteOffset != 0 && cfg.offsetMs == 0L) applyOffset(res, remoteOffset.toLong()) else res
                }
            } catch (_: Exception) { serverOk = false }
        }

        /* 2) 上游提供商 */
        val providers = cfg.sources.mapNotNull {
            when (it.trim()) {
                "netease" -> NetEaseProvider
                "qq" -> QQProvider
                else -> null
            }
        }
        val query = buildQuery(track)
        for (p in providers) {
            val candidates = try { p.search(http, query) } catch (_: Exception) { emptyList() }
            if (candidates.isEmpty()) continue
            val best = Matcher.select(track, candidates) ?: continue
            val res = try { p.fetch(http, best) } catch (_: Exception) { null } ?: continue
            if (res.lines.isEmpty()) continue
            /* 逐字偏好:如果结果是逐行的且还有合格候选,可以尝试下一个(简化:接受首个可用) */
            return res.copy(
                provider = best.provider,
                providerId = best.id,
                displayName = ServerProvider.providerDisplay(best.provider),
            )
        }
        return null
    }

    private fun buildQuery(track: TrackInfo): String {
        val artist = track.artists.firstOrNull() ?: ""
        return "${track.title} $artist".trim()
    }

    /** 整体平移时间轴(行与逐字一起移) */
    private fun applyOffset(res: LyricsResult, offset: Long): LyricsResult {
        if (offset == 0L) return res
        return res.copy(lines = res.lines.map { l ->
            l.copy(startMs = l.startMs + offset, endMs = l.endMs + offset,
                words = l.words.map { w -> w.copy(startMs = w.startMs + offset, endMs = w.endMs + offset) })
        })
    }

    fun clear() { cache.clear(); negative.clear() }
}
