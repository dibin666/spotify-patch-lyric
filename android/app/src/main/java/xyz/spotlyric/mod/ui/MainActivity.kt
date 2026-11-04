package xyz.spotlyric.mod.ui

import android.content.Context
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import xyz.spotlyric.mod.data.Prefs
import xyz.spotlyric.mod.engine.Engine
import xyz.spotlyric.mod.engine.EngineConfig
import xyz.spotlyric.mod.engine.TrackInfo

class MainActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MaterialTheme(colorScheme = darkColorScheme()) {
                Surface(Modifier.fillMaxSize()) { SettingsScreen() }
            }
        }
    }

    private fun prefs() = getSharedPreferences(Prefs.NAME, Context.MODE_WORLD_READABLE)

    @Composable
    fun SettingsScreen() {
        val p = remember { prefs() }
        var refresh by remember { mutableIntStateOf(0) }
        fun put(k: String, v: Any) {
            p.edit().apply {
                when (v) {
                    is Boolean -> putBoolean(k, v)
                    is Int -> putInt(k, v)
                    is Long -> putLong(k, v)
                    else -> putString(k, v.toString())
                }
            }.apply(); refresh++
        }

        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp)
                .statusBarsPadding()
                .navigationBarsPadding(),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            Text("SpotLyric", style = MaterialTheme.typography.headlineMedium)
            Text("Spotify 歌词注入模块", style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)

            /* ---- 状态卡 ---- */
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("状态", style = MaterialTheme.typography.titleMedium)
                    @Suppress("UNUSED_EXPRESSION") refresh
                    val active = p.getBoolean(Prefs.ST_ACTIVE, false)
                    val err = p.getString(Prefs.ST_LAST_ERROR, "") ?: ""
                    StatusRow("模块", if (active) "已注入 ✓" else "未激活(请在 LSPosed 中启用并重启 Spotify)")
                    StatusRow("Spotify", p.getString(Prefs.ST_SPOTIFY_VERSION, "—") ?: "—")
                    StatusRow("当前曲目", "${p.getString(Prefs.ST_TRACK_TITLE, "—")} — ${p.getString(Prefs.ST_TRACK_ARTIST, "")}")
                    StatusRow("歌词源", p.getString(Prefs.ST_PROVIDER, "—") ?: "—")
                    StatusRow("同步类型", p.getString(Prefs.ST_SYNC_TYPE, "—") ?: "—")
                    StatusRow("已注入", "${p.getInt(Prefs.ST_INJECT_COUNT, 0)} 首")
                    if (err.isNotEmpty()) Text("错误:$err", color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
                }
            }

            /* ---- 总开关 ---- */
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("歌词注入", style = MaterialTheme.typography.titleMedium)
                    SwitchRow("启用注入", p.getBoolean(Prefs.ENABLED, true)) { put(Prefs.ENABLED, it) }
                    SwitchRow("无结果时回退官方歌词", p.getBoolean(Prefs.FALLBACK_OFFICIAL, true)) { put(Prefs.FALLBACK_OFFICIAL, it) }
                    SwitchRow("逐字歌词", p.getBoolean(Prefs.WORD_SYNC, true)) { put(Prefs.WORD_SYNC, it) }
                    SwitchRow("携带译文", p.getBoolean(Prefs.TRANSLATION, true)) { put(Prefs.TRANSLATION, it) }
                    SwitchRow("覆盖 Spotify 歌词开关(旗标)", p.getBoolean(Prefs.FLAG_OVERRIDES, true)) { put(Prefs.FLAG_OVERRIDES, it) }
                }
            }

            /* ---- 词源 ---- */
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("歌词来源", style = MaterialTheme.typography.titleMedium)
                    val sources = p.getString(Prefs.SOURCES, Prefs.DEFAULT_SOURCES) ?: Prefs.DEFAULT_SOURCES
                    SwitchRow("网易云音乐", sources.contains("netease")) { on ->
                        put(Prefs.SOURCES, toggleSource(sources, "netease", on))
                    }
                    SwitchRow("QQ 音乐", sources.contains("qq")) { on ->
                        put(Prefs.SOURCES, toggleSource(sources, "qq", on))
                    }
                }
            }

            /* ---- 服务器 ---- */
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("歌词服务器(可选)", style = MaterialTheme.typography.titleMedium)
                    Text("共享匹配库优先,或经服务器中转请求(网络受限环境)",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    var url by remember(refresh) { mutableStateOf(p.getString(Prefs.SERVER_URL, "") ?: "") }
                    OutlinedTextField(
                        value = url, onValueChange = { url = it },
                        label = { Text("服务器地址") },
                        placeholder = { Text("https://lyrics.example.com") },
                        modifier = Modifier.fillMaxWidth(), singleLine = true,
                    )
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Button(onClick = { put(Prefs.SERVER_URL, url.trim()) }) { Text("保存") }
                        val mode = p.getString(Prefs.SERVER_MODE, Prefs.SERVER_OFF) ?: Prefs.SERVER_OFF
                        FilterChip(
                            selected = mode == Prefs.SERVER_BINDINGS, onClick = {
                                put(Prefs.SERVER_MODE, if (mode == Prefs.SERVER_BINDINGS) Prefs.SERVER_OFF else Prefs.SERVER_BINDINGS)
                            }, label = { Text("共享库") })
                        FilterChip(
                            selected = mode == Prefs.SERVER_RELAY, onClick = {
                                put(Prefs.SERVER_MODE, if (mode == Prefs.SERVER_RELAY) Prefs.SERVER_OFF else Prefs.SERVER_RELAY)
                            }, label = { Text("中转") })
                    }

                    var off by remember(refresh) { mutableStateOf(p.getInt(Prefs.OFFSET_MS, 0).toString()) }
                    OutlinedTextField(
                        value = off,
                        onValueChange = { off = it.filter { c -> c.isDigit() || c == '-' } },
                        label = { Text("全局偏移(ms)") },
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
                        modifier = Modifier.fillMaxWidth(), singleLine = true,
                    )
                    Button(onClick = { put(Prefs.OFFSET_MS, off.toIntOrNull() ?: 0) }) { Text("保存偏移") }
                }
            }

            /* ---- 引擎自测 ---- */
            var testResult by remember { mutableStateOf("") }
            var testing by remember { mutableStateOf(false) }
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("引擎自测", style = MaterialTheme.typography.titleMedium)
                    Text("在 App 内直接跑一次匹配,验证词源连通性",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    Button(enabled = !testing, onClick = {
                        testing = true; testResult = "测试中…"
                        lifecycleScope.launch {
                            testResult = withContext(Dispatchers.IO) { runTest() }
                            testing = false
                        }
                    }) { Text(if (testing) "…" else "测试") }
                    if (testResult.isNotEmpty()) Text(testResult, style = MaterialTheme.typography.bodySmall)
                }
            }

            Spacer(Modifier.height(24.dp))
        }
    }

    private fun runTest(): String = try {
        val track = TrackInfo(
            uri = "spotify:track:test", id = "test",
            title = "夜に駆ける", artists = listOf("YOASOBI"), album = "THE BOOK",
            durationMs = 260_000,
        )
        val res = Engine.lyricsFor(track, EngineConfig())
        if (res != null) "✓ ${res.displayName} · ${res.lines.size} 行 · ${res.syncType} · 首行「${res.lines.first().text}」"
        else "未匹配(可正常联网则检查词源设置)"
    } catch (e: Exception) {
        "失败:${e.message}"
    }

    private fun toggleSource(cur: String, name: String, on: Boolean): String {
        val set = cur.split(",").filter { it.isNotBlank() }.toMutableSet()
        if (on) set.add(name) else set.remove(name)
        return set.joinToString(",")
    }

    @Composable
    fun StatusRow(label: String, value: String) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.bodyMedium)
        }
    }

    @Composable
    fun SwitchRow(label: String, checked: Boolean, onToggle: (Boolean) -> Unit) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween) {
            Text(label, style = MaterialTheme.typography.bodyMedium)
            Switch(checked = checked, onCheckedChange = onToggle)
        }
    }
}
