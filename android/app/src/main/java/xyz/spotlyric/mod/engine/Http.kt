package xyz.spotlyric.mod.engine

import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import java.security.MessageDigest
import java.util.zip.GZIPInputStream

/* 极简 HTTP 客户端(hook 进程内跑,只用 JDK 自带类,避免给 Spotify 引入新依赖) */
object Net {

    class Resp(val code: Int, val body: String)

    class Request(
        val method: String,
        val url: String,
        val headers: Map<String, String> = emptyMap(),
        val body: String? = null,
        val timeoutMs: Int = 8000,
    )

    fun execute(r: Request): Resp {
        var conn: HttpURLConnection? = null
        try {
            conn = URL(r.url).openConnection() as HttpURLConnection
            conn.requestMethod = r.method
            conn.connectTimeout = r.timeoutMs
            conn.readTimeout = r.timeoutMs
            conn.setRequestProperty("Accept-Encoding", "gzip")
            conn.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14)")
            for ((k, v) in r.headers) conn.setRequestProperty(k, v)
            if (r.body != null) {
                conn.doOutput = true
                OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(r.body) }
            }
            val code = conn.responseCode
            val stream = if (code in 200..399) conn.inputStream else conn.errorStream
            val raw = stream?.let {
                if ("gzip".equals(conn.contentEncoding, true)) GZIPInputStream(it) else it
            } ?: return Resp(code, "")
            val text = BufferedReader(InputStreamReader(raw, Charsets.UTF_8)).use { it.readText() }
            return Resp(code, text)
        } finally {
            conn?.disconnect()
        }
    }

    fun getJson(r: Request): JSONObject {
        val resp = execute(r)
        if (resp.code !in 200..299) throw HttpException(resp.code, resp.body.take(200))
        return JSONObject(resp.body)
    }

    fun urlEncode(s: String): String = URLEncoder.encode(s, "UTF-8")

    /** SHA-1 十六进制大写(zzc 签名用) */
    fun sha1Hex(text: String): String {
        val md = MessageDigest.getInstance("SHA-1")
        val bytes = md.digest(text.toByteArray(Charsets.UTF_8))
        val sb = StringBuilder(40)
        for (b in bytes) sb.append(String.format("%02X", b))
        return sb.toString()
    }

    /** 经自建服务器 /api/relay 转发上游请求(设备到不了网易/QQ 时用) */
    fun viaRelay(serverUrl: String, r: Request): Resp {
        val req = JSONObject()
            .put("method", r.method)
            .put("url", r.url)
            .put("headers", JSONObject(r.headers))
            .put("body", r.body ?: "")
        val resp = execute(Request("POST", serverUrl.trimEnd('/') + "/api/relay",
            mapOf("Content-Type" to "application/json"), req.toString(), 12000))
        if (resp.code !in 200..299) return resp
        val obj = JSONObject(resp.body)
        return Resp(obj.optInt("status", 502), obj.optString("body"))
    }
}

class HttpException(val code: Int, msg: String) : Exception("HTTP $code: $msg")

/* 引擎侧统一出口:直连或 relay */
fun interface Http {
    fun execute(r: Net.Request): Net.Resp
}
