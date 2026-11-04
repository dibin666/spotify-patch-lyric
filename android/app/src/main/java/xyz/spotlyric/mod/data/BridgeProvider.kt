package xyz.spotlyric.mod.data

import android.content.ContentProvider
import android.content.ContentValues
import android.database.Cursor
import android.net.Uri
import android.os.Bundle
import org.json.JSONArray
import org.json.JSONObject

/**
 * App 侧 ContentProvider —— Spotify 进程内的 hook 通过 contentResolver.call()
 * 读取配置、回写运行状态(作为 remote prefs 之外的兜底通道)。
 *
 * 方法:
 *   call("config")          → Bundle{ 各配置键 }
 *   call("status", json)    → 写入状态环缓冲(最大 50 条)+ 立即更新 status_* 键
 *   call("status/log")      → Bundle{ json: JSONArray }
 */
class BridgeProvider : ContentProvider() {

    companion object {
        const val AUTHORITY = "xyz.spotlyric.mod.bridge"
        val URI: Uri = Uri.parse("content://$AUTHORITY")
        private const val LOG_LIMIT = 50
        private val statusLog = JSONArray()
    }

    override fun onCreate(): Boolean = true

    override fun call(method: String, arg: String?, extras: Bundle?): Bundle {
        val out = Bundle()
        val ctx = context ?: return out
        when (method) {
            "config" -> {
                val p = ctx.getSharedPreferences(Prefs.NAME, 0)
                out.putBoolean(Prefs.ENABLED, p.getBoolean(Prefs.ENABLED, true))
                out.putBoolean(Prefs.FALLBACK_OFFICIAL, p.getBoolean(Prefs.FALLBACK_OFFICIAL, true))
                out.putBoolean(Prefs.WORD_SYNC, p.getBoolean(Prefs.WORD_SYNC, true))
                out.putBoolean(Prefs.TRANSLATION, p.getBoolean(Prefs.TRANSLATION, true))
                out.putString(Prefs.SOURCES, p.getString(Prefs.SOURCES, Prefs.DEFAULT_SOURCES))
                out.putString(Prefs.SERVER_URL, p.getString(Prefs.SERVER_URL, ""))
                out.putString(Prefs.SERVER_MODE, p.getString(Prefs.SERVER_MODE, Prefs.SERVER_OFF))
                out.putInt(Prefs.OFFSET_MS, p.getInt(Prefs.OFFSET_MS, 0))
                out.putBoolean(Prefs.FLAG_OVERRIDES, p.getBoolean(Prefs.FLAG_OVERRIDES, true))
            }
            "status" -> {
                arg ?: return out
                val p = ctx.getSharedPreferences(Prefs.NAME, 0)
                try {
                    val ev = JSONObject(arg)
                    val it = ev.keys()
                    val editor = p.edit()
                    while (it.hasNext()) {
                        val k = it.next()
                        if (!k.startsWith("status_")) continue
                        val v = ev.get(k)
                        when (v) {
                            is Boolean -> editor.putBoolean(k, v)
                            is Int -> editor.putInt(k, v)
                            is Long -> editor.putLong(k, v)
                            else -> editor.putString(k, v.toString())
                        }
                    }
                    editor.apply()
                    synchronized(statusLog) {
                        ev.put("ts", System.currentTimeMillis())
                        statusLog.put(ev)
                        while (statusLog.length() > LOG_LIMIT) statusLog.remove(0)
                    }
                } catch (_: Exception) { /* malformed event */ }
            }
            "status/log" -> {
                synchronized(statusLog) { out.putString("json", statusLog.toString()) }
            }
        }
        return out
    }

    override fun query(u: Uri, p: Array<out String>?, s: String?, sa: Array<out String>?, o: String?): Cursor? = null
    override fun getType(uri: Uri): String? = null
    override fun insert(uri: Uri, values: ContentValues?): Uri? = null
    override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?): Int = 0
    override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int = 0
}
