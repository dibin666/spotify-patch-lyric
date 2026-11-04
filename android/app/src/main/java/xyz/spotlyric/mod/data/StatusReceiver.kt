package xyz.spotlyric.mod.data

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.json.JSONObject

/**
 * Hook 进程 → App 的状态通道。
 * ContentProvider.call 受 Android 11+ 包可见性限制(Spotify 看不到我们),
 * 显式组件广播不受限 —— sendBroadcast(ComponentName(包名,类名)) 直接送达。
 */
class StatusReceiver : BroadcastReceiver() {

    companion object {
        const val ACTION = "xyz.spotlyric.mod.STATUS"
        const val EXTRA_JSON = "json"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION) return
        val json = intent.getStringExtra(EXTRA_JSON) ?: return
        try {
            val ev = JSONObject(json)
            val p = context.getSharedPreferences(Prefs.NAME, Context.MODE_PRIVATE)
            val editor = p.edit()
            val it = ev.keys()
            while (it.hasNext()) {
                val k = it.next()
                if (!k.startsWith("status_")) continue
                when (val v = ev.get(k)) {
                    is Boolean -> editor.putBoolean(k, v)
                    is Int -> editor.putInt(k, v)
                    is Long -> editor.putLong(k, v)
                    else -> editor.putString(k, v.toString())
                }
            }
            editor.apply()
        } catch (_: Exception) { }
    }
}
