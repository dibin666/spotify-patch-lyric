package xyz.spotlyric.mod.engine

/* LRC / 逐字(yrc) 解析与翻译合并 —— core.js parseLrc/parseYrc/mergeTranslation 移植。 */
object Lrc {

    private val TAG = Regex("\\[([a-z]+):([^\\]]*)\\]")
    private val TIME = Regex("\\[(\\d+)[:.](\\d+)(?:[:.](\\d+))?\\]")
    /* yrc 行: [startMs,durMs](wStart,wDur,0)字(...)  兼容网易云逐字与旧 [mm:ss.xx] 行 */
    private val YRC_HEAD = Regex("^\\s*\\[(\\d+)\\s*,\\s*(\\d+)\\s*\\]")
    private val YRC_WORD = Regex("\\((\\d+)\\s*,\\s*(\\d+)\\s*,\\s*\\d+\\)([^()]*)")

    private fun timeMs(m: MatchResult): Long {
        val min = m.groupValues[1].toLong()
        val sec = m.groupValues[2].toLong()
        val frac = m.groupValues.getOrNull(3) ?: ""
        val ms = when (frac.length) { 1 -> frac.toLong() * 100; 2 -> frac.toLong() * 10; 3 -> frac.toLong(); else -> 0L }
        return min * 60000 + sec * 1000 + ms
    }

    private fun isMeta(text: String): Boolean =
        TAG.find(text)?.groupValues?.get(1) in setOf("ti", "ar", "al", "by", "offset", "re", "ve", "length", "au", "kana")

    /** 标准 LRC:多时间戳行、[ti:] 元数据过滤、offset 标签 */
    fun parseLrc(text: String, translation: String? = null, provider: String = ""): LyricsResult {
        var offset = 0L
        val offsetTag = Regex("\\[offset:([+-]?\\d+)\\]").find(text)
        if (offsetTag != null) offset = offsetTag.groupValues[1].toLong()

        data class Raw(val time: Long, val text: String)
        val raws = ArrayList<Raw>()
        for (raw in text.lines()) {
            val line = raw.trim()
            if (line.isEmpty() || isMeta(line) && !TIME.containsMatchIn(line)) continue
            val stamps = TIME.findAll(line).toList()
            if (stamps.isEmpty()) continue
            val body = line.substring(stamps.last().range.last + 1).trim()
            for (s in stamps) raws += Raw(timeMs(s), body)
        }
        return assemble(raws.map { LyricLine(it.text, it.time, it.time, null, emptyList()) }, offset, translation, provider)
    }

    /** 网易云逐字(yrc)或与 LRC 混合格式 */
    fun parseYrc(text: String, translation: String? = null, provider: String = "netease"): LyricsResult? {
        val raws = ArrayList<LyricLine>()
        for (raw in text.lines()) {
            val line = raw.trim()
            if (line.isEmpty()) continue
            val head = YRC_HEAD.find(line) ?: continue
            val start = head.groupValues[1].toLong()
            val dur = head.groupValues[2].toLong()
            val rest = line.substring(head.range.last + 1)
            val words = YRC_WORD.findAll(rest).map { m ->
                Word(m.groupValues[3], m.groupValues[1].toLong(), m.groupValues[1].toLong() + m.groupValues[2].toLong())
            }.toList()
            val body = words.joinToString("") { it.text }.ifEmpty { rest.trim() }
            if (body.isEmpty()) continue
            raws += LyricLine(body, start, start + dur, null, words)
        }
        if (raws.isEmpty()) return null
        return assemble(raws, 0, translation, provider)
    }

    /** 排序、补齐 endMs、合并翻译、判定 syncType */
    private fun assemble(raws: List<LyricLine>, offset: Long, translation: String?, provider: String): LyricsResult {
        val sorted = raws.sortedBy { it.startMs }
        val lines = ArrayList<LyricLine>(sorted.size)
        for (i in sorted.indices) {
            val l = sorted[i]
            val start = l.startMs - offset
            val end = if (i + 1 < sorted.size) sorted[i + 1].startMs - offset else start + 10000
            val words = l.words.map { w ->
                val ws = w.startMs - offset
                val we = w.endMs - offset
                Word(w.text, ws, if (we > ws) we else maxOf(ws, end))
            }
            lines += LyricLine(l.text, start, maxOf(start, end), l.translatedText, words)
        }
        if (translation != null) mergeTranslation(lines, translation)
        val hasWords = lines.any { it.words.isNotEmpty() }
        return LyricsResult(
            provider = provider,
            syncType = if (lines.isEmpty()) LyricsResult.SyncType.UNSYNCED
                else if (hasWords) LyricsResult.SyncType.WORD else LyricsResult.SyncType.LINE,
            lines = lines,
        )
    }

    /* 翻译按同 start 对齐,剩余单调 ±3000ms 就近补(mergeTranslation) */
    private fun mergeTranslation(lines: MutableList<LyricLine>, translation: String) {
        if (translation.isBlank()) return
        val parsed = if (YRC_HEAD.containsMatchIn(translation)) parseYrc(translation, null)?.lines ?: emptyList()
            else parseLrc(translation, null).lines
        val translated = parsed.filter { it.text.isNotBlank() && it.text.trim() != "//" }
        val targets = lines.indices.filter { lines[it].text.isNotBlank() }
        if (translated.isEmpty() || targets.isEmpty()) return

        val byTime = HashMap<Long, Int>()
        for (i in targets) byTime.putIfAbsent(lines[i].startMs, i)
        val rest = ArrayList<LyricLine>()
        for (t in translated) {
            val i = byTime[t.startMs]
            if (i != null && lines[i].translatedText == null) {
                lines[i] = lines[i].copy(translatedText = t.text)
            } else rest += t
        }
        val free = targets.filter { lines[it].translatedText == null }
        var from = 0
        for (t in rest) {
            var best = -1; var bestDiff = Long.MAX_VALUE
            for (k in from until free.size) {
                val diff = kotlin.math.abs(lines[free[k]].startMs - t.startMs)
                if (diff < bestDiff) { best = k; bestDiff = diff }
                else if (lines[free[k]].startMs > t.startMs) break
            }
            if (best < 0 || bestDiff > 3000) continue
            lines[free[best]] = lines[free[best]].copy(translatedText = t.text)
            from = best + 1
        }
    }

    /** 网易云响应:lrc/tlyric/yrc/ytlrc/romalrc —— 逐字优先,按文本桥补翻译 */
    fun fromNetEase(raw: org.json.JSONObject): LyricsResult? {
        fun lyr(key: String) = raw.optJSONObject(key)?.optString("lyric") ?: ""
        val lrc = lyr("lrc"); val tlyric = lyr("tlyric")
        val yrc = lyr("yrc"); val ytlrc = lyr("ytlrc")
        val romalrc = lyr("romalrc")

        var result: LyricsResult? = null
        if (yrc.isNotBlank()) result = parseYrc(yrc, null, "netease")
        if (result == null || result.lines.isEmpty()) result = parseLrc(lrc, null, "netease")

        /* 翻译:yrc 优先按时间桥;补漏用 lrc 时间轴 mergeTranslationByText 简化版 */
        val transText = if (result.syncType == LyricsResult.SyncType.WORD) (ytlrc.ifBlank { tlyric }) else tlyric
        if (transText.isNotBlank() && result != null) {
            val mut = result.lines.toMutableList()
            mergeTranslation(mut, transText)
            result = result.copy(lines = mut)
        }
        /* 罗马音作为第二翻译源塞进 translatedText 无主的行?暂不,留 translationLangs */
        if (result != null && romalrc.isNotBlank()) {
            result = result.copy(translationLangs = result.translationLangs + "romaji")
        }
        return result?.takeIf { it.lines.isNotEmpty() }
    }

    /** QQ 响应:{lyric: base64, trans: base64} 或 qrc 原始 */
    fun fromQQ(lyricText: String, transText: String): LyricsResult? {
        val result = parseLrc(lyricText, null, "qq")
        if (result.lines.isEmpty()) return null
        if (transText.isNotBlank()) {
            val mut = result.lines.toMutableList()
            mergeTranslation(mut, transText)
            return result.copy(lines = mut)
        }
        return result
    }
}
