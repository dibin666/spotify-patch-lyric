package xyz.spotlyric.mod.module

import android.content.pm.ApplicationInfo
import android.os.Parcelable
import dalvik.system.DexFile
import java.lang.reflect.Constructor
import java.lang.reflect.Modifier

/**
 * 类定位:优先版本固定表(快),失败回退 dex 指纹扫描(慢但抗混淆漂移)。
 * 指纹 = docs/android/field-mapping-*.md §8 的字段/签名特征。
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
    private data class Pins(
        val onf0: String, val itf0: String, val pnf0: String,
        val lnf0: String, val bhf0: String, val aey0: String, val aey0Impls: List<String>,
        val a9h: String, val fef0: String, val aef0: String,
        val cef0: String, val def0: String, val bef0: String,
        val eef0: String, val bff0: String,
    )

    private val PINNED = mapOf(
        /* Spotify 9.2.0.26 (148373686) */
        148373686L to Pins(
            onf0 = "p.onf0", itf0 = "p.itf0", pnf0 = "p.pnf0",
            lnf0 = "p.lnf0", bhf0 = "p.bhf0", aey0 = "p.aey0", aey0Impls = listOf("p.e2t", "p.f141"),
            a9h = "p.a9h", fef0 = "p.fef0", aef0 = "p.aef0",
            cef0 = "p.cef0", def0 = "p.def0", bef0 = "p.bef0",
            eef0 = "p.eef0", bff0 = "p.bff0",
        ),
    )

    private fun pin(cls: ClassLoader, name: String, optional: Boolean = false): Class<*>? =
        try { Class.forName(name, false, cls) } catch (_: Throwable) {
            if (!optional) throw ClassNotFoundException(name) else null
        }

    fun resolve(info: ApplicationInfo, cls: ClassLoader): Roles {
        val (vc, _) = ApkVersion.read(info.sourceDir)
        val pins = PINNED[vc] ?: PINNED[148373686L]
        try {
            if (pins != null) return resolvePinned(cls, pins)
        } catch (_: Throwable) { /* pin 失效 → 指纹扫描 */ }
        return resolveFingerprint(info, cls)
    }

    private fun resolvePinned(cls: ClassLoader, p: Pins): Roles {
        val onf0 = pin(cls, p.onf0)!!
        return Roles(
            onf0 = onf0,
            onf0Impls = listOfNotNull(pin(cls, p.itf0, true), pin(cls, p.pnf0, true))
                .ifEmpty { implsOf(cls, onf0) },
            lnf0 = pin(cls, p.lnf0, true),
            bhf0 = pin(cls, p.bhf0, true),
            aey0 = pin(cls, p.aey0, true),
            aey0Impls = p.aey0Impls.mapNotNull { pin(cls, it, true) },
            a9h = pin(cls, p.a9h)!!,
            fef0 = pin(cls, p.fef0)!!,
            aef0 = pin(cls, p.aef0)!!,
            cef0 = pin(cls, p.cef0)!!,
            def0 = pin(cls, p.def0)!!,
            bef0 = pin(cls, p.bef0)!!,
            eef0 = pin(cls, p.eef0, true),
            bff0 = pin(cls, p.bff0)!!,
        )
    }

    /* ---------------- 指纹扫描(版本未知的兜底) ---------------- */

    private fun dexClasses(info: ApplicationInfo, cls: ClassLoader): List<Class<*>> {
        val out = ArrayList<Class<*>>(2048)
        val paths = ArrayList<String>()
        info.sourceDir?.let { paths += it }
        info.splitSourceDirs?.let { paths += it }
        for (path in paths) {
            try {
                val dex = DexFile(path)
                val e = dex.entries()
                while (e.hasMoreElements()) {
                    val n = e.nextElement()
                    /* 领域类全在 p.* 顶层短混淆名;缩小加载面 */
                    if (!n.startsWith("p.") || n.count { it == '.' } != 1 || n.length > 10) continue
                    try { out += Class.forName(n, false, cls) } catch (_: Throwable) { }
                }
            } catch (_: Throwable) { }
        }
        return out
    }

    private fun isParcelable(c: Class<*>) = Parcelable::class.java.isAssignableFrom(c)

    private fun ctorSig(c: Class<*>, vararg types: Class<*>): Constructor<*>? =
        try { c.getDeclaredConstructor(*types) } catch (_: Throwable) { null }

    private fun fields(c: Class<*>) = c.declaredFields.filter { !it.isSynthetic }

    private fun resolveFingerprint(info: ApplicationInfo, cls: ClassLoader): Roles {
        val all = dexClasses(info, cls)

        val single = runCatching { Class.forName("io.reactivex.rxjava3.core.Single", false, cls) }.getOrNull()

        /* cef0: Parcelable (int,int) */
        val cef0 = all.firstOrNull { c ->
            isParcelable(c) && fields(c).count { it.type == Int::class.javaPrimitiveType } == 2 &&
                ctorSig(c, Int::class.javaPrimitiveType!!, Int::class.javaPrimitiveType!!) != null
        } ?: throw ClassNotFoundException("cef0")

        /* eef0: Parcelable (boolean) 单字段 */
        val eef0 = all.firstOrNull { c ->
            isParcelable(c) && fields(c).size == 1 && fields(c)[0].type == Boolean::class.javaPrimitiveType
        }

        /* bff0: Parcelable 5×int + boolean */
        val bff0 = all.firstOrNull { c ->
            isParcelable(c) && fields(c).count { it.type == Int::class.javaPrimitiveType } == 5 &&
                fields(c).count { it.type == Boolean::class.javaPrimitiveType } == 1
        } ?: throw ClassNotFoundException("bff0")

        /* bef0: Parcelable 3×String + getId() */
        val bef0 = all.firstOrNull { c ->
            isParcelable(c) && fields(c).count { it.type == String::class.java } == 3 &&
                c.methods.any { it.name == "getId" }
        } ?: throw ClassNotFoundException("bef0")

        /* def0: Parcelable (String,List,boolean) */
        val def0 = all.firstOrNull { c ->
            isParcelable(c) && fields(c).let { f ->
                f.any { it.type == String::class.java } && f.any { it.type == List::class.java } &&
                    f.any { it.type == Boolean::class.javaPrimitiveType } && f.size <= 4
            }
        } ?: throw ClassNotFoundException("def0")

        /* aef0: Parcelable (long,String,ArrayList) */
        val aef0 = all.firstOrNull { c ->
            isParcelable(c) && fields(c).let { f ->
                f.any { it.type == Long::class.javaPrimitiveType } &&
                    f.any { it.type == String::class.java } &&
                    f.any { java.util.ArrayList::class.java.isAssignableFrom(it.type) || it.type == List::class.java }
            }
        } ?: throw ClassNotFoundException("aef0")

        /* fef0: Parcelable 9字段 List,int,List,String,boolean,?, ?,int,List */
        val fef0 = all.firstOrNull { c ->
            isParcelable(c) && fields(c).let { f ->
                f.size in 8..10 &&
                    f.count { List::class.java.isAssignableFrom(it.type) } >= 3 &&
                    f.count { it.type == Int::class.javaPrimitiveType } == 2 &&
                    f.count { it.type == String::class.java } == 1 &&
                    f.count { it.type == Boolean::class.javaPrimitiveType } == 1 &&
                    f.any { it.type == bef0 }
            }
        } ?: throw ClassNotFoundException("fef0")

        /* a9h: Parcelable 字段含 (fef0,bff0) */
        val a9h = all.firstOrNull { c ->
            isParcelable(c) && fields(c).let { f -> f.any { it.type == fef0 } && f.any { it.type == bff0 } }
        } ?: throw ClassNotFoundException("a9h")

        /* onf0: interface,两方法返 Single(String)/(String,String) */
        val onf0 = all.firstOrNull { c ->
            c.isInterface && single != null && c.declaredMethods.count {
                it.parameterTypes.all { p -> p == String::class.java } && it.returnType == single
            } == 2
        } ?: throw ClassNotFoundException("onf0")

        val onf0Impls = all.filter { onf0.isAssignableFrom(it) && !it.isInterface && !Modifier.isAbstract(it.modifiers) }

        /* aey0: 旗标解析器签名组合 (String,boolean)→bool + (String,Enum)→Enum + (int,int,int,String)→int */
        val aey0 = all.firstOrNull { c ->
            val ms = c.declaredMethods
            ms.any { it.returnType == Boolean::class.javaPrimitiveType &&
                    it.parameterTypes.contentEquals(arrayOf(String::class.java, Boolean::class.javaPrimitiveType)) } &&
            ms.any { it.returnType == Enum::class.java &&
                    it.parameterTypes.size == 2 && it.parameterTypes[0] == String::class.java } &&
            ms.any { it.returnType == Int::class.javaPrimitiveType &&
                    it.parameterTypes.size == 4 && it.parameterTypes[3] == String::class.java }
        }
        val aey0Impls = if (aey0 != null && aey0.isInterface)
            all.filter { aey0.isAssignableFrom(it) && !it.isInterface && !Modifier.isAbstract(it.modifiers) }
            else emptyList()

        /* bhf0: a(ContextTrack)→boolean + 有 Provider 型字段 */
        val ctxTrack = runCatching { Class.forName("com.spotify.player.model.ContextTrack", false, cls) }.getOrNull()
        val bhf0 = all.firstOrNull { c ->
            ctxTrack != null && !c.isInterface &&
                c.declaredMethods.any {
                    it.name == "a" && it.returnType == Boolean::class.javaPrimitiveType &&
                        it.parameterTypes.contentEquals(arrayOf(ctxTrack))
                }
        }

        /* lnf0: 含 onf0 字段的类(仓库) */
        val lnf0 = all.firstOrNull { c ->
            !c.isInterface && fields(c).any { it.type == onf0 } &&
                c.declaredMethods.any { it.returnType == single && it.parameterTypes.size == 2 }
        }

        return Roles(onf0, onf0Impls, lnf0, bhf0, aey0, aey0Impls,
            a9h, fef0, aef0, cef0, def0, bef0, eef0, bff0)
    }

    private fun implsOf(cls: ClassLoader, iface: Class<*>): List<Class<*>> {
        /* pin 失效且无法扫描 dex 时的兜底:常见的邻近实现名 */
        return listOf("p.itf0", "p.pnf0").mapNotNull { pin(cls, it, true) }
            .filter { iface.isAssignableFrom(it) }
    }
}
