package xyz.spotlyric.mod.engine

import android.util.Base64
import org.json.JSONArray
import org.json.JSONObject

/* 上游歌词源:网易云 / QQ / 自建 spot-lyric-server。端点与 core.js 对齐。 */

interface Provider {
    val name: String
    fun search(http: Http, query: String): List<Candidate>
    fun fetch(http: Http, c: Candidate): LyricsResult?
}

private fun at(obj: JSONObject?, path: String): Any? {
    var cur: Any? = obj ?: return null
    for (seg in path.split('/')) {
        cur = when (cur) {
            is JSONObject -> cur.opt(seg)
            else -> return null
        } ?: return null
    }
    return cur
}

private fun str(obj: JSONObject?, path: String): String = when (val v = at(obj, path)) {
    is String -> v
    is Number -> v.toString()
    else -> ""
}

private fun intOf(v: Any?): Long = when (v) {
    is Number -> v.toLong()
    is String -> v.toLongOrNull() ?: 0L
    else -> 0L
}

private fun strings(v: Any?, limit: Int = 50): List<String> = when (v) {
    is JSONArray -> (0 until minOf(v.length(), limit)).mapNotNull { v.optString(it, null) }
    else -> emptyList()
}

object NetEaseProvider : Provider {
    override val name = "netease"
    private const val HOST = "https://music.163.com"
    private val REFERER = mapOf("Referer" to "https://music.163.com/")

    override fun search(http: Http, query: String): List<Candidate> {
        val q = TextNorm.normalize(query)
        val resp = Net.getJson(Net.Request("GET",
            "$HOST/api/search/get/web?s=${Net.urlEncode(q)}&type=1&offset=0&total=false&limit=20",
            REFERER))
        return parseCandidates(resp)
    }

    private fun parseCandidates(resp: JSONObject): List<Candidate> {
        val out = ArrayList<Candidate>()
        val songs = at(resp, "result/songs") as? JSONArray ?: at(resp, "songs") as? JSONArray ?: return out
        for (i in 0 until minOf(songs.length(), 100)) {
            val s = songs.optJSONObject(i) ?: continue
            val id = s.optLong("id", 0)
            val title = s.optString("name")
            if (id == 0L || title.isEmpty()) continue
            val artists = (s.optJSONArray("artists") ?: s.optJSONArray("ar"))
                ?.let { ar -> (0 until minOf(ar.length(), 50)).mapNotNull { ar.optJSONObject(it)?.optString("name") } }
                ?: emptyList()
            val album = str(s, "album/name").ifEmpty { str(s, "al/name") }
            val duration = (intOf(s.opt("duration")).takeIf { it > 0 } ?: intOf(s.opt("dt")))
                .takeIf { it in 1..86400000 } ?: 0
            val aliases = ArrayList<String>()
            for (p in listOf("alias", "transNames", "alia", "tns")) {
                for (a in strings(at(s, p), 8)) if (a.isNotBlank() && a != title && a !in aliases) aliases += a.take(300)
            }
            out += Candidate("netease", id.toString(), "", title, album, duration, artists, aliases)
        }
        return out
    }

    override fun fetch(http: Http, c: Candidate): LyricsResult? {
        val id = Net.urlEncode(c.id)
        /* v1 端点带逐字 yrc/ytlrc/romalrc;失败退回老端点 */
        val urls = listOf(
            "$HOST/api/song/lyric/v1?id=$id&cp=false&lv=0&kv=0&tv=0&rv=0&yv=0&ytv=0&yrv=0",
            "$HOST/api/song/lyric?id=$id&lv=-1&kv=-1&tv=-1",
        )
        for (u in urls) {
            try {
                val res = Net.getJson(Net.Request("GET", u, REFERER))
                val r = Lrc.fromNetEase(res)
                if (r != null) return r.copy(
                    providerId = c.id,
                    providerName = "netease",
                    displayName = "网易云音乐",
                )
            } catch (_: Exception) { /* try next */ }
        }
        return null
    }
}

object QQProvider : Provider {
    override val name = "qq"
    private const val SEARCH_URL = "https://u.y.qq.com/cgi-bin/musics.fcg"
    private const val LYRIC_URL = "https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg"

    /* zzc 签名:SHA-1(body) 取位 + 掩码(base64 去掉 /+=) —— jixunmoe/qmweb-sign 算法 */
    private val ZZC_PART1 = intArrayOf(23, 14, 6, 36, 16, 40, 7, 19)
    private val ZZC_PART2 = intArrayOf(16, 1, 32, 12, 19, 27, 8, 5)
    private val ZZC_SCRAMBLE = intArrayOf(89, 39, 179, 150, 218, 82, 58, 252, 177, 52, 186, 123, 120, 64, 242, 133, 143, 161, 121, 179)

    private fun zzcSign(text: String): String {
        val hash = Net.sha1Hex(text)
        val pick = { ix: IntArray -> ix.map { hash[it] }.joinToString("") }
        val part3 = ByteArray(ZZC_SCRAMBLE.size) { i ->
            (ZZC_SCRAMBLE[i] xor hash.substring(i * 2, i * 2 + 2).toInt(16)).toByte()
        }
        val b64 = Base64.encodeToString(part3, Base64.NO_WRAP).replace(Regex("[\\\\/+=]"), "")
        return "zzc${pick(ZZC_PART1)}$b64${pick(ZZC_PART2)}".lowercase()
    }

    private fun searchId(): String {
        val sb = StringBuilder(37)
        repeat(32) { sb.append((Math.random() * 16).toInt().toString(16)) }
        return sb.toString().uppercase() + (Math.random() * 100000).toInt().toString().padStart(5, '0')
    }

    override fun search(http: Http, query: String): List<Candidate> {
        val q = TextNorm.normalize(query)
        val body = JSONObject()
            .put("comm", JSONObject()
                .put("_channelid", "0").put("_os_version", "6.2.9200-2").put("ct", "19").put("cv", "2151")
                .put("guid", searchId().take(32)).put("patch", "118")
                .put("psrf_access_token_expiresAt", 0).put("psrf_qqaccess_token", "")
                .put("psrf_qqopenid", "").put("psrf_qqunionid", "")
                .put("tmeAppID", "qqmusic").put("tmeLoginType", 0).put("uin", "0")
                .put("wid", ((Math.random() * 8e18) + 1e18).toLong().toString()))
            .put("music.search.SearchCgiService", JSONObject()
                .put("module", "music.search.SearchCgiService").put("method", "DoSearchForQQMusicDesktop")
                .put("param", JSONObject()
                    .put("grp", 1).put("num_per_page", 20).put("page_num", 1)
                    .put("query", q).put("remoteplace", "txt.newclient.top")
                    .put("search_type", 0).put("searchid", searchId())))
            .toString()
        val resp = Net.getJson(Net.Request("POST", "$SEARCH_URL?sign=${zzcSign(body)}",
            mapOf("Referer" to "https://c.y.qq.com/", "Content-Type" to "application/json"), body))
        return parseCandidates(resp)
    }

    private fun parseCandidates(resp: JSONObject): List<Candidate> {
        val out = ArrayList<Candidate>()
        val paths = listOf(
            "music.search.SearchCgiService/data/body/song/list",
            "req_1/data/body/song/list", "req/data/body/song/list", "result/songs", "songs",
        )
        var list: JSONArray? = null
        for (p in paths) { list = at(resp, p) as? JSONArray; if (list != null) break }
        list ?: return out
        fun add(s: JSONObject?) {
            if (s == null || out.size >= 100) return
            val title = s.optString("title"); val id = intOf(s.opt("id"))
            if (id == 0L || title.isEmpty()) return
            val album = str(s, "album/title").ifEmpty { str(s, "album/name") }
            val duration = intOf(s.opt("interval")).coerceIn(0, 86400) * 1000
            val artists = (s.optJSONArray("singer"))
                ?.let { ar -> (0 until minOf(ar.length(), 50)).mapNotNull { ar.optJSONObject(it)?.optString("name") } }
                ?: emptyList()
            val aliases = ArrayList<String>()
            for (a in strings(at(s, "name"), 8) + strings(at(s, "subtitle"), 8))
                if (a.isNotBlank() && a != title && a !in aliases) aliases += a.take(300)
            if (out.none { it.id == id.toString() }) {
                out += Candidate("qq", id.toString(), s.optString("mid"), title, album, duration, artists, aliases)
            }
        }
        for (i in 0 until list.length()) {
            val s = list.optJSONObject(i) ?: continue
            add(s)
            (s.optJSONArray("group"))?.let { g -> for (j in 0 until g.length()) add(g.optJSONObject(j)) }
        }
        return out
    }

    override fun fetch(http: Http, c: Candidate): LyricsResult? {
        /* 主端点:musicu PlayLyricInfo(qrc/trans/roma);失败退 base64 老端点 */
        val body = JSONObject()
            .put("comm", JSONObject()
                .put("ct", 24).put("cv", 4747474).put("format", "json")
                .put("g_tk", "5381").put("g_tk_new_20200303", "5381")
                .put("inCharset", "utf-8").put("outCharset", "utf-8")
                .put("platform", "yqq.json").put("uin", 0))
            .put("req_1", JSONObject()
                .put("module", "music.musichallSong.PlayLyricInfo").put("method", "GetPlayLyricInfo")
                .put("param", JSONObject()
                    .put("qrc", 1).put("qrc_t", 0).put("roma", 1).put("trans", 1)
                    .put("songID", c.id.toLongOrNull() ?: 0).put("songMID", c.mid)))
            .toString()
        try {
            val res = Net.getJson(Net.Request("POST", SEARCH_URL,
                mapOf("Referer" to "https://c.y.qq.com/", "Content-Type" to "application/json"), body))
            val data = at(res, "req_1/data") as? JSONObject
            val lyric = decode(data?.optString("lyric"))
            val trans = decode(data?.optString("trans"))
            if (lyric.isNotEmpty()) {
                val r = Lrc.fromQQ(lyric, trans)
                if (r != null) return r.copy(providerId = c.id, providerName = "qq", displayName = "QQ 音乐")
            }
        } catch (_: Exception) { /* fallback */ }

        if (c.mid.isNotEmpty()) {
            try {
                val form = "songmid=${Net.urlEncode(c.mid)}&g_tk=5381&format=json&inCharset=utf8&outCharset=utf-8&notice=0&platform=yqq.json&needNewCode=0"
                val res = Net.getJson(Net.Request("POST", LYRIC_URL,
                    mapOf("Referer" to "https://y.qq.com/", "Content-Type" to "application/x-www-form-urlencoded"), form))
                val lyric = decode(res.optString("lyric"))
                val trans = decode(res.optString("trans"))
                if (lyric.isNotEmpty()) {
                    val r = Lrc.fromQQ(lyric, trans)
                    if (r != null) return r.copy(providerId = c.id, providerName = "qq", displayName = "QQ 音乐")
                }
            } catch (_: Exception) { }
        }
        return null
    }

    private fun decode(text: String?): String {
        if (text.isNullOrEmpty()) return ""
        if (text.contains("[")) return text
        return try { String(Base64.decode(text, Base64.DEFAULT), Charsets.UTF_8) } catch (_: Exception) { "" }
    }
}

/** 自建服务器:共享匹配库 bindings(首选) */
object ServerProvider {
    fun fetchBinding(http: Http, serverUrl: String, trackId: String): Pair<LyricsResult, Int>? {
        val url = serverUrl.trimEnd('/') + "/api/bindings/" + Net.urlEncode(trackId)
        val resp = http.execute(Net.Request("GET", url))
        if (resp.code != 200) return null
        val binding = JSONObject(resp.body).optJSONObject("binding") ?: return null
        val lyr = binding.optJSONObject("lyrics") ?: return null
        val match = binding.optJSONObject("match")
        val offset = binding.optInt("offset_ms", 0)
        val lines = ArrayList<LyricLine>()
        val arr = lyr.optJSONArray("lines") ?: JSONArray()
        for (i in 0 until arr.length()) {
            val l = arr.optJSONObject(i) ?: continue
            val words = ArrayList<Word>()
            l.optJSONArray("words")?.let { w ->
                for (j in 0 until w.length()) {
                    val wo = w.optJSONObject(j) ?: continue
                    words += Word(wo.optString("text"), wo.optLong("start_time_ms"), wo.optLong("end_time_ms"))
                }
            }
            lines += LyricLine(
                l.optString("text"), l.optLong("start_time_ms"), l.optLong("end_time_ms"),
                l.optString("translated_text").takeIf { it.isNotEmpty() }, words)
        }
        if (lines.isEmpty()) return null
        val provider = match?.optString("provider") ?: lyr.optString("provider", "server")
        val result = LyricsResult(
            provider = provider,
            providerId = match?.optString("id") ?: "",
            providerName = "server",
            displayName = providerDisplay(provider),
            language = lyr.optString("language", ""),
            syncType = if (lines.any { it.words.isNotEmpty() }) LyricsResult.SyncType.WORD else LyricsResult.SyncType.LINE,
            lines = lines,
        )
        return result to offset
    }

    fun providerDisplay(provider: String) = when (provider) {
        "netease" -> "网易云音乐"; "qq" -> "QQ 音乐"; "spotify" -> "Spotify"; "local" -> "本地文件"
        else -> provider.ifEmpty { "共享库" }
    }
}
