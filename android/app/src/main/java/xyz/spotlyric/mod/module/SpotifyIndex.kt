package xyz.spotlyric.mod.module

import android.content.pm.ApplicationInfo
import android.os.Parcelable
import dalvik.system.DexFile
import java.lang.reflect.Constructor
import java.lang.reflect.Modifier

/**
 * 类定位三层策略:
 *   1. versionCode 固定表(PINNED)+ 签名验证
 *   2. 上次指纹结果(remote prefs "resolved_map" 持久化)+ 签名验证
 *   3. dex 指纹扫描 —— 以 a9h 主构造为锚点,交叉推导 bef0/eef0/bff0/fef0
 * 任何一步失败落下一层;成功后把名表回写供下次快启。
 */
object SpotifyIndex {

    data class Roles(
        val onf0: Class<*>,
        val onf0Impls: List<Class<*>>,
        val lnf0: Class<*>?,
        val bhf0: Class<*>?,
        val aey0: Class<*>?,
        val aey0Impls: List<Class<*>>,
        val a9h: Class<*>,
        val fef0: Class<*>,
        val aef0: Class<*>,
        val cef0: Class<*>,
        val def0: Class<*>,
        val bef0: Class<*>,
        val eef0: Class<*>?,
        val bff0: Class<*>,
    )

    /* ---- 版本固定表(versionCode → 混淆名) ---- */
    data class Pins(
        val onf0: String, val onf0Impls: List<String>,
        val lnf0: String, val bhf0: String,
        val aey0: String, val aey0Impls: List<String>,
        val a9h: String, val fef0: String, val aef0: String,
        val cef0: String, val def0: String, val bef0: String,
        val eef0: String, val bff0: String,
    ) {
        fun toJson(): org.json.JSONObject = org.json.JSONObject().apply {
            put("onf0", onf0); put("onf0Impls", onf0Impls.joinToString(","))
            put("lnf0", lnf0); put("bhf0", bhf0)
            put("aey0", aey0); put("aey0Impls", aey0Impls.joinToString(","))
            put("a9h", a9h); put("fef0", fef0); put("aef0", aef0)
            put("cef0", cef0); put("def0", def0); put("bef0", bef0)
            put("eef0", eef0); put("bff0", bff0)
        }

        companion object {
            fun fromJson(j: org.json.JSONObject) = Pins(
                onf0 = j.optString("onf0"),
                onf0Impls = j.optString("onf0Impls").split(",").filter { it.isNotBlank() },
                lnf0 = j.optString("lnf0"), bhf0 = j.optString("bhf0"),
                aey0 = j.optString("aey0"),
                aey0Impls = j.optString("aey0Impls").split(",").filter { it.isNotBlank() },
                a9h = j.optString("a9h"), fef0 = j.optString("fef0"), aef0 = j.optString("aef0"),
                cef0 = j.optString("cef0"), def0 = j.optString("def0"), bef0 = j.optString("bef0"),
                eef0 = j.optString("eef0"), bff0 = j.optString("bff0"),
            )
        }
    }

    private val PINNED = mapOf(
        /* Spotify 9.2.0.26 (148373686) */
        148373686L to Pins(
            onf0 = "p.onf0", onf0Impls = listOf("p.itf0", "p.pnf0"),
            lnf0 = "p.lnf0", bhf0 = "p.bhf0",
            aey0 = "p.aey0", aey0Impls = listOf("p.e2t", "p.f141"),
            a9h = "p.a9h", fef0 = "p.fef0", aef0 = "p.aef0",
            cef0 = "p.cef0", def0 = "p.def0", bef0 = "p.bef0",
            eef0 = "p.eef0", bff0 = "p.bff0",
        ),
        /* Spotify 9.2.0.400 (148376304) —— 指纹扫描实测(2026-11-04) */
        148376304L to Pins(
            onf0 = "p.aq70", onf0Impls = listOf("p.bq70"),
            lnf0 = "p.bq70", bhf0 = "p.bl9",
            aey0 = "p.nfy0", aey0Impls = listOf("p.p241", "p.x2t"),
            a9h = "p.e9h", fef0 = "p.nff0", aef0 = "p.iff0",
            cef0 = "p.el70", def0 = "p.ah41", bef0 = "p.jff0",
            eef0 = "p.mff0", bff0 = "p.jgf0",
        ),
    )

    var resolvedFrom = ""   // "pin:148373686" / "persisted" / "fingerprint"
        private set
    var versionCode = 0L
        private set
    var versionName = ""
        private set

    fun resolve(info: ApplicationInfo, cls: ClassLoader): Roles {
        val (vc, vn) = ApkVersion.read(info.sourceDir)
        versionCode = vc; versionName = vn
        if (vc == 0L && ApkVersion.lastError.isNotEmpty()) {
            /* 仅记录,不影响流程 */
            System.err.println("SpotLyric: ApkVersion " + ApkVersion.lastError)
        }
        /* 1) 版本固定表 */
        PINNED[vc]?.let { pins ->
            resolveByNames(cls, pins)?.let { resolvedFrom = "pin:$vc"; return it }
        }
        /* 2) 持久化的上次结果 */
        loadPersisted(cls)?.let { resolvedFrom = "persisted"; return it }
        /* 3) 各版本 pin 盲试(同名可能仍有效) */
        for ((code, pins) in PINNED) {
            resolveByNames(cls, pins)?.let { resolvedFrom = "pin-blind:$code"; return it }
        }
        /* 4) 指纹扫描 */
        resolvedFrom = "fingerprint"
        return resolveFingerprint(info, cls)
    }

    /** 解析结果序列化 → remote prefs(由调用方回写) */
    fun pinsJson(r: Roles): String = Pins(
        r.onf0.name, r.onf0Impls.map { it.name },
        r.lnf0?.name ?: "", r.bhf0?.name ?: "",
        r.aey0?.name ?: "", r.aey0Impls.map { it.name },
        r.a9h.name, r.fef0.name, r.aef0.name, r.cef0.name,
        r.def0.name, r.bef0.name, r.eef0?.name ?: "", r.bff0.name,
    ).toJson().toString()

    @Volatile var persistedJson: String = ""
    private fun loadPersisted(cls: ClassLoader): Roles? {
        if (persistedJson.isEmpty()) return null
        return try { resolveByNames(cls, Pins.fromJson(org.json.JSONObject(persistedJson))) } catch (_: Throwable) { null }
    }

    /* ---------------- 按名解析 + 签名验证 ---------------- */

    private fun find(cls: ClassLoader, name: String): Class<*>? =
        if (name.isBlank()) null else try { Class.forName(name, false, cls) } catch (_: Throwable) { null }

    /* 反射访问统一防御:某些类的方法签名引用缺失类 → NoClassDefFoundError */
    private fun fields(c: Class<*>) = try { c.declaredFields.filter { !it.isSynthetic } } catch (_: Throwable) { emptyList() }
    private fun ctors(c: Class<*>) = try { c.declaredConstructors.toList() } catch (_: Throwable) { emptyList() }
    private fun methods(c: Class<*>) = try { c.declaredMethods.toList() } catch (_: Throwable) { emptyList() }
    private fun isParcelable(c: Class<*>) = Parcelable::class.java.isAssignableFrom(c)

    private fun hasCtor(c: Class<*>, vararg pred: (Class<*>) -> Boolean): Boolean =
        ctors(c).any { ctor ->
            ctor.parameterTypes.size == pred.size &&
                pred.zip(ctor.parameterTypes).all { (p, t) -> p(t) }
        }

    private fun isInt(t: Class<*>) = t == Int::class.javaPrimitiveType
    private fun isBool(t: Class<*>) = t == Boolean::class.javaPrimitiveType
    private fun isLong(t: Class<*>) = t == Long::class.javaPrimitiveType
    private fun isStr(t: Class<*>) = t == String::class.java
    private fun isList(t: Class<*>) = List::class.java.isAssignableFrom(t) || java.util.ArrayList::class.java.isAssignableFrom(t)

    /** 验证 roles 各签名;任一核心项不合法返回 null */
    private fun verify(cls: ClassLoader, r: Roles): Roles? {
        if (!isParcelable(r.a9h) || !isParcelable(r.fef0) || !isParcelable(r.aef0)) return null
        /* a9h: 必须存在主构造或 (fef0,bff0) */
        val a9hOk = ctors(r.a9h).any { ctor ->
            val p = ctor.parameterTypes
            (p.size == 10 && isList(p[0]) && isInt(p[1]) && isList(p[2]) && isStr(p[3]) && isBool(p[4]) &&
                p[5] == r.bef0 && (r.eef0 == null || p[6] == r.eef0) && isInt(p[7]) && isList(p[8]) && p[9] == r.bff0) ||
                (p.size == 2 && p[0] == r.fef0 && p[1] == r.bff0)
        }
        if (!a9hOk) return null
        /* fef0: 9 参构造 */
        if (!ctors(r.fef0).any { it.parameterTypes.size == 9 }) return null
        /* cef0: (int,int) */
        if (!hasCtor(r.cef0, ::isInt, ::isInt)) return null
        /* aef0: (long,String,集合) */
        if (!hasCtor(r.aef0, ::isLong, ::isStr, ::isList)) return null
        /* def0: (String,List,boolean) */
        if (!hasCtor(r.def0, ::isStr, ::isList, ::isBool)) return null
        /* bef0: (String,String,String) */
        if (!hasCtor(r.bef0, ::isStr, ::isStr, ::isStr)) return null
        /* bff0: 5×int + boolean */
        if (!hasCtor(r.bff0, ::isInt, ::isInt, ::isInt, ::isInt, ::isInt, ::isBool)) return null
        /* onf0: 接口且有 Single 返回方法 */
        val single = runCatching { Class.forName("io.reactivex.rxjava3.core.Single", false, cls) }.getOrNull()
        if (single != null && !r.onf0.isInterface) return null
        if (single != null && methods(r.onf0).none { it.returnType == single }) return null
        return r
    }

    private fun resolveByNames(cls: ClassLoader, p: Pins): Roles? {
        val onf0 = find(cls, p.onf0) ?: return null
        val r = Roles(
            onf0 = onf0,
            onf0Impls = p.onf0Impls.mapNotNull { find(cls, it) }.filter { onf0.isAssignableFrom(it) },
            lnf0 = find(cls, p.lnf0),
            bhf0 = find(cls, p.bhf0),
            aey0 = find(cls, p.aey0),
            aey0Impls = p.aey0Impls.mapNotNull { find(cls, it) },
            a9h = find(cls, p.a9h) ?: return null,
            fef0 = find(cls, p.fef0) ?: return null,
            aef0 = find(cls, p.aef0) ?: return null,
            cef0 = find(cls, p.cef0) ?: return null,
            def0 = find(cls, p.def0) ?: return null,
            bef0 = find(cls, p.bef0) ?: return null,
            eef0 = find(cls, p.eef0),
            bff0 = find(cls, p.bff0) ?: return null,
        )
        return verify(cls, r)
    }

    /* ---------------- 指纹扫描 ---------------- */

    private fun dexClasses(info: ApplicationInfo, cls: ClassLoader): List<Class<*>> {
        val out = ArrayList<Class<*>>(2048)
        val paths = ArrayList<String>()
        info.sourceDir?.let { paths += it }
        info.splitSourceDirs?.let { paths += it }
        /* 短混淆包名:p.xxx / a.xxx 等一级包 */
        val shortName = Regex("^[a-z]\\.[a-z0-9_]{1,7}$")
        for (path in paths) {
            try {
                val dex = DexFile(path)
                val e = dex.entries()
                while (e.hasMoreElements()) {
                    val n = e.nextElement()
                    if (!shortName.matches(n)) continue
                    try { out += Class.forName(n, false, cls) } catch (_: Throwable) { }
                }
            } catch (_: Throwable) { }
        }
        return out
    }

    private fun resolveFingerprint(info: ApplicationInfo, cls: ClassLoader): Roles {
        val all = dexClasses(info, cls)
        val single = Class.forName("io.reactivex.rxjava3.core.Single", false, cls)

        /* 锚点:a9h —— Parcelable + 10参构造 (List,int,List,String,boolean,?, ?,int,List,?)
           或 (X,Y) 双参 Parcelable 构造 */
        data class A9hPick(val cls: Class<*>, val bef0: Class<*>, val eef0: Class<*>?, val bff0: Class<*>, val easy: Boolean)

        val a9hPick = all.mapNotNull { c ->
            if (!isParcelable(c)) return@mapNotNull null
            for (ctor in ctors(c)) {
                val p = ctor.parameterTypes
                if (p.size == 10 && isList(p[0]) && isInt(p[1]) && isList(p[2]) && isStr(p[3]) && isBool(p[4]) &&
                    isParcelable(p[5]) && isInt(p[7]) && isList(p[8]) && isParcelable(p[9])) {
                    return@mapNotNull A9hPick(c, p[5], p[6].takeIf { isParcelable(it) }, p[9], true)
                }
                if (p.size == 2 && isParcelable(p[0]) && isParcelable(p[1])) {
                    /* (fef0,bff0) —— fef0 字段形状校验 */
                    val fef = p[0]
                    val f = fields(fef)
                    if (f.size in 8..10 && f.count { isList(it.type) } >= 3 &&
                        f.count { isInt(it.type) } == 2 && f.count { isStr(it.type) } == 1 &&
                        f.count { isBool(it.type) } == 1) {
                        val bef = f.firstOrNull { isParcelable(it.type) && hasCtor(it.type, ::isStr, ::isStr, ::isStr) }
                        val eef = f.firstOrNull { isParcelable(it.type) && fields(it.type).size == 1 && isBool(fields(it.type)[0].type) }
                        return@mapNotNull A9hPick(c, bef?.type ?: continue, eef?.type, p[1], false)
                    }
                }
            }
            null
        }.firstOrNull() ?: throw ClassNotFoundException("a9h")

        val a9h = a9hPick.cls
        val bef0 = a9hPick.bef0
        val eef0 = a9hPick.eef0
        val bff0 = a9hPick.bff0

        /* fef0: a9h 的字段之一或 9参构造 */
        val fef0 = fields(a9h).firstOrNull { isParcelable(it.type) && it.type != bff0 }?.type
            ?: all.firstOrNull { c ->
                isParcelable(c) && ctors(c).any {
                    val p = it.parameterTypes
                    p.size == 9 && isList(p[0]) && isInt(p[1]) && isList(p[2]) && isStr(p[3]) && isBool(p[4])
                }
            } ?: throw ClassNotFoundException("fef0")

        /* cef0 / aef0 / def0: 形状唯一性较高的 Parcelable */
        val cef0 = all.firstOrNull { c ->
            isParcelable(c) && fields(c).size == 2 && fields(c).all { isInt(it.type) } &&
                hasCtor(c, ::isInt, ::isInt)
        } ?: throw ClassNotFoundException("cef0")

        val aef0 = all.firstOrNull { c ->
            isParcelable(c) && hasCtor(c, ::isLong, ::isStr, ::isList)
        } ?: throw ClassNotFoundException("aef0")

        val def0 = all.firstOrNull { c ->
            isParcelable(c) && hasCtor(c, ::isStr, ::isList, ::isBool)
        } ?: throw ClassNotFoundException("def0")

        /* onf0: interface,≥2 个 (String...)→Single 方法 */
        val onf0 = all.firstOrNull { c ->
            c.isInterface && methods(c).count {
                it.returnType == single && it.parameterTypes.isNotEmpty() &&
                    it.parameterTypes[0] == String::class.java
            } >= 2
        } ?: throw ClassNotFoundException("onf0")

        val onf0Impls = all.filter { onf0.isAssignableFrom(it) && !it.isInterface && !Modifier.isAbstract(it.modifiers) }

        /* aey0: 3 方法签名组合 */
        val aey0 = all.firstOrNull { c ->
            val ms = methods(c)
            ms.any { it.returnType == Boolean::class.javaPrimitiveType &&
                    it.parameterTypes.contentEquals(arrayOf(String::class.java, Boolean::class.javaPrimitiveType)) } &&
            ms.any { it.returnType == Enum::class.java && it.parameterTypes.size == 2 &&
                    it.parameterTypes[0] == String::class.java } &&
            ms.any { it.returnType == Int::class.javaPrimitiveType && it.parameterTypes.size == 4 &&
                    it.parameterTypes[3] == String::class.java }
        }
        val aey0Impls = if (aey0 != null && aey0.isInterface)
            all.filter { aey0.isAssignableFrom(it) && !it.isInterface && !Modifier.isAbstract(it.modifiers) }
        else emptyList()

        /* bhf0: (ContextTrack)→boolean */
        val ctxTrack = runCatching { Class.forName("com.spotify.player.model.ContextTrack", false, cls) }.getOrNull()
        val bhf0 = all.firstOrNull { c ->
            ctxTrack != null && !c.isInterface &&
                methods(c).any {
                    it.name == "a" && it.returnType == Boolean::class.javaPrimitiveType &&
                        it.parameterTypes.contentEquals(arrayOf(ctxTrack))
                }
        }

        /* lnf0: 持 onf0 字段 + (String,...)→Single 方法(排除 onf0 实现自身) */
        val lnf0 = all.firstOrNull { c ->
            !c.isInterface && !onf0.isAssignableFrom(c) && fields(c).any { it.type == onf0 } &&
                methods(c).any { it.returnType == single && it.parameterTypes.isNotEmpty() &&
                    it.parameterTypes[0] == String::class.java }
        }

        return Roles(onf0, onf0Impls, lnf0, bhf0, aey0, aey0Impls,
            a9h, fef0, aef0, cef0, def0, bef0, eef0, bff0)
    }
}
