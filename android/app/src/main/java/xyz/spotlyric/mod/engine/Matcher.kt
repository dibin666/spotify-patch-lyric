package xyz.spotlyric.mod.engine

import java.text.Normalizer
import xyz.spotlyric.mod.engine.TextNorm as T

/* 候选打分 —— core.js matchScore/artistSimilarity/versionFlags 的移植。 */
object Matcher {

    private const val DURATION_TOLERANCE = 3000L

    /* 录音版本标签:同集合才可匹配(Live/Remix/Acoustic…) */
    private val VERSION_PATTERNS = listOf(
        Regex("(^|[^a-z])(live|concert)([^a-z]|$)|现场|演唱会|ライブ"),
        Regex("(^|[^a-z])cover([^a-z]|$)|翻唱|原唱|翻自|カバー"),
        Regex("(^|[^a-z])(instrumental|karaoke|off ?vocal|inst)([^a-z]|$)|伴奏|纯音乐|カラオケ|インスト"),
        Regex("(^|[^a-z])(remix|mix|dj)([^a-z]|$)|混音|dj版|リミックス"),
        Regex("sped[ -]?up|slowed|nightcore|加速|慢速|降调|升调"),
        Regex("radio[ -]?edit|tv[ -]?(size|ver|edit)|short[ -]?ver|game[ -]?size|剪辑|ショート"),
        Regex("(^|[^a-z])acoustic([^a-z]|$)|不插电"),
        Regex("(^|[^a-z])(piano|orchestra|orchestral|music box|8[ -]?bit|lo-?fi)([^a-z]|$)|钢琴|八音盒|管弦"),
        Regex("(^|[^a-z])demo([^a-z]|$)"),
        Regex("[^\\s(\\[【〔（-]+(?:[ -]|(?<![a-z]))ver(?:sion)?\\.?(?=$|[\\s)\\]】〕）-])|版(?=$|[\\s)\\]】〕）-])"),
    )

    private val NEUTRAL_VERSION = Regex(
        "(original|extended|album|main)[ -]?mix|(album|single|original|main|lp|explicit|clean|full|remaster(ed)?|stereo|mono)[ -]?ver(sion)?\\.?"
    )

    fun versionFlags(title: String): Int {
        val lower = T.toSimplified(Normalizer.normalize(title, Normalizer.Form.NFKC).lowercase())
            .replace(NEUTRAL_VERSION, "")
        var result = 0
        VERSION_PATTERNS.forEachIndexed { i, p -> if (p.containsMatchIn(lower)) result = result or (1 shl i) }
        return result
    }

    /* 不改变录音身份的注释:feat./remaster/OST/主题曲 等(titleCore) */
    private val NEUTRAL_NOTE = Regex(
        "^(?:feat\\.?\\s.*|ft\\.?\\s.*|featuring\\s.*|with\\s.*|prod\\.?\\s.*|explicit|clean|bonus(?: track)?|" +
        "deluxe(?: edition| version)?|(?:\\d{4}\\s+)?(?:digital(?:ly)?\\s+)?remaster(?:ed)?(?:\\s+\\d{4})?(?:\\s+version)?|mono|stereo|" +
        "(?:album|single|original|main|lp)\\s+version|(?:original|extended|album)\\s+mix|from\\s.*|taken from\\s.*|.*\\bost\\b.*|" +
        ".*(?:主题曲|主題曲|插曲|片头曲|片頭曲|片尾曲|主題歌|主题歌|挿入歌|オープニング|エンディング|テーマ|原声带|原聲帶|电视剧|電視劇|电影|電影|动画|動畫|アニメ|ゲーム).*)$",
        RegexOption.IGNORE_CASE
    )
    private val BRACKETED = Regex("\\s*[（(【\\[]([^（()）【】\\[\\]]*)[）)】\\]]")
    private val DASH_NOTE = Regex("\\s+[-–—]\\s+(.+)$")

    fun titleCore(title: String): String {
        var t = Normalizer.normalize(title, Normalizer.Form.NFKC)
        t = t.replace(BRACKETED) { m -> if (NEUTRAL_NOTE.matches(m.groupValues[1].trim())) "" else m.value }
        val dash = DASH_NOTE.find(t)
        if (dash != null && NEUTRAL_NOTE.matches(dash.groupValues[1].trim())) {
            t = t.substring(0, dash.range.first)
        }
        return t.replace(Regex("\\s+(?:feat\\.?|ft\\.?|featuring)\\s+.*$", RegexOption.IGNORE_CASE), "").trim()
    }

    /* 艺人名拆解:全名 + CV 括号拆分 + feat./、/;/, 分隔(artistNames) */
    fun artistNames(full: String): List<String> {
        val names = linkedSetOf<String>()
        val norm = Normalizer.normalize(full.trim(), Normalizer.Form.NFKC)
        if (norm.isNotEmpty()) names.add(norm)
        val cv = Regex("^(.*?)\\s*[(（]\\s*(?:cv|vo|vocal|唱)\\s*[.:：]?\\s*([^)）]+)[)）]\\s*$", RegexOption.IGNORE_CASE).find(norm)
            ?: Regex("^(.*?)\\s*[(（]([^)）]+)[)）]\\s*$").find(norm)
        if (cv != null) { names.add(cv.groupValues[1].trim()); names.add(cv.groupValues[2].trim()) }
        for (part in norm.split(Regex("\\s*(?:[/／、;；,，]|\\s(?:feat\\.?|ft\\.?|featuring)\\s)\\s*", RegexOption.IGNORE_CASE))) {
            if (part.isNotEmpty()) names.add(part)
        }
        return names.filter { T.normalize(it).isNotEmpty() }
    }

    private fun entrySimilarity(left: List<String>, right: List<String>): Double {
        var best = 0.0
        for (x in left) for (y in right) {
            best = maxOf(best, T.textSimilarity(x, y))
            if (best == 1.0) return 1.0
        }
        return best
    }

    private val VARIOUS = Regex("^(various artists?|群星|羣星|华语群星|v\\.?\\s?a\\.?)$", RegexOption.IGNORE_CASE)

    fun artistSimilarity(left: List<String>, right: List<String>): Double {
        if (left.isEmpty() || right.isEmpty()) return 0.0
        val L = left.map(::artistNames).filter { it.isNotEmpty() }
        val R = right.map(::artistNames).filter { it.isNotEmpty() }
        if (L.isEmpty() || R.isEmpty()) return 0.0
        if (L.size > 3 && R.size == 1 && R[0].any { VARIOUS.matches(it) }) return 0.8
        val bestL = L.map { l -> R.maxOf { r -> entrySimilarity(l, r) } }
        val principal = bestL.first()
        if (principal < 0.75) return principal
        val bestR = R.map { r -> L.maxOf { l -> entrySimilarity(l, r) } }
        val found = bestL.count { it >= 0.8 } + bestR.count { it >= 0.8 }
        return 0.8 * principal + 0.2 * found / (L.size + R.size)
    }

    /* QQ 报整秒:真实时长 ∈ [interval, interval+1s) */
    fun durationDelta(trackMs: Long, c: Candidate): Long {
        if (trackMs <= 0 || c.durationMs <= 0) return -1
        if (trackMs <= c.durationMs) return c.durationMs - trackMs
        return maxOf(0, trackMs - c.durationMs - (if (c.provider == "qq") 999 else 0))
    }

    fun durationScore(delta: Long): Double = when {
        delta < 0 -> 0.0
        delta == 0L -> 1.0
        delta < 300 -> 0.95
        delta < 700 -> 0.9
        delta < 1500 -> 0.8
        delta < 3500 -> 0.55
        else -> 0.0
    }

    private val W = doubleArrayOf(40.0, 30.0, 10.0, 20.0) // title/artist/album/duration

    fun titleSimilarity(title: String, c: Candidate): Double {
        var best = T.textSimilarity(title, c.title)
        best = maxOf(best, T.textSimilarity(titleCore(title), titleCore(c.title)))
        for (a in c.aliases) best = maxOf(best, T.textSimilarity(titleCore(title), titleCore(a)))
        return best
    }

    fun score(track: TrackInfo, c: Candidate): Candidate {
        c.eligible = false; c.score = 0.0
        c.deltaMs = durationDelta(track.durationMs, c)
        c.titleScore = titleSimilarity(track.title, c)
        c.artistScore = artistSimilarity(track.artists, c.artists)
        val hasAlbum = track.album.isNotEmpty() && c.album.isNotEmpty()
        val hasDuration = c.deltaMs >= 0
        c.albumScore = if (hasAlbum)
            maxOf(T.textSimilarity(track.album, c.album), T.textSimilarity(titleCore(track.album), titleCore(c.album))) else 0.0
        c.durationScore = durationScore(c.deltaMs)
        val total = W[0] + W[1] + (if (hasAlbum) W[2] else 0.0) + (if (hasDuration) W[3] else 0.0)
        c.score = 100.0 * (W[0] * c.titleScore + W[1] * c.artistScore +
            (if (hasAlbum) W[2] * c.albumScore else 0.0) + (if (hasDuration) W[3] * c.durationScore else 0.0)) / total
        val sameVersion = versionFlags(track.title) == versionFlags(c.title)
        if (!sameVersion) c.score *= 0.6
        c.reason = when {
            c.deltaMs < 0 -> "总时长未知"
            c.deltaMs > DURATION_TOLERANCE -> "总时长相差超过 3 秒"
            !sameVersion -> "歌曲版本不一致"
            c.titleScore < 0.8 -> "歌名相似度不足"
            c.artistScore < 0.75 -> if (T.scriptsDiffer(track.artists.firstOrNull(), c.artists.firstOrNull())) "艺术家语言不同" else "主艺术家不匹配"
            c.score < 80 -> "综合匹配分数不足"
            else -> { c.eligible = true; "通过" }
        }
        return c
    }

    /** 依序返回首个合格候选(eligible);合格者优先,分数高者优先 */
    fun select(track: TrackInfo, candidates: List<Candidate>): Candidate? =
        candidates.map { score(track, it) }
            .sortedWith(compareByDescending<Candidate> { it.eligible }.thenByDescending { it.score })
            .firstOrNull { it.eligible }
}
