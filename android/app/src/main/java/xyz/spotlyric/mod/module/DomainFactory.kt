package xyz.spotlyric.mod.module

import xyz.spotlyric.mod.engine.LyricLine
import xyz.spotlyric.mod.engine.LyricsResult
import java.lang.reflect.Constructor

/**
 * 把 LyricsResult 反射装配成宿主领域模型 a9h(见 field-mapping 文档 §3)。
 * 构造链:cef0 → aef0 → def0 → bef0/eef0/bff0 → fef0 → a9h
 */
class DomainFactory(private val r: SpotifyIndex.Roles) {

    private val cef0Ctor: Constructor<*> = ctor(r.cef0, Int::class.javaPrimitiveType!!, Int::class.javaPrimitiveType!!)
    private val aef0Ctor: Constructor<*> = r.aef0.declaredConstructors.first {
        it.parameterTypes.size == 3 &&
            it.parameterTypes[0] == Long::class.javaPrimitiveType &&
            it.parameterTypes[1] == String::class.java
    }
    private val def0Ctor: Constructor<*> = r.def0.declaredConstructors.first {
        it.parameterTypes.size == 3 &&
            it.parameterTypes[0] == String::class.java &&
            List::class.java.isAssignableFrom(it.parameterTypes[1]) &&
            it.parameterTypes[2] == Boolean::class.javaPrimitiveType
    }
    private val bef0Ctor: Constructor<*> = r.bef0.declaredConstructors.first {
        it.parameterTypes.size == 3 && it.parameterTypes.all { p -> p == String::class.java }
    }
    private val bff0Ctor: Constructor<*> = r.bff0.declaredConstructors.first {
        it.parameterTypes.size == 6 &&
            it.parameterTypes.take(5).all { p -> p == Int::class.javaPrimitiveType } &&
            it.parameterTypes[5] == Boolean::class.javaPrimitiveType
    }

    /* a9h 便捷构造:(List,int,List,String,boolean,bef0,?,int,List,bff0);
       第 7 参 eef0 类型宽松匹配(版本间可能漂移);缺失时走 fef0 + a9h(fef0,bff0) */
    private val a9hEasyCtor: Constructor<*>? = r.a9h.declaredConstructors.firstOrNull {
        val p = it.parameterTypes
        p.size == 10 &&
            List::class.java.isAssignableFrom(p[0]) &&
            p[1] == Int::class.javaPrimitiveType &&
            List::class.java.isAssignableFrom(p[2]) &&
            p[3] == String::class.java &&
            p[4] == Boolean::class.javaPrimitiveType &&
            p[5] == r.bef0 &&
            (r.eef0 == null || p[6] == r.eef0) &&
            p[7] == Int::class.javaPrimitiveType &&
            List::class.java.isAssignableFrom(p[8]) &&
            p[9] == r.bff0
    }
    /* eef0 槽位的实际类型(指纹推导可能与 Roles.eef0 不同) */
    private val eef0Type: Class<*>? = a9hEasyCtor?.parameterTypes?.get(6) ?: r.eef0
    private val eef0Ctor: Constructor<*>? = eef0Type?.let { cls ->
        cls.declaredConstructors.firstOrNull {
            it.parameterTypes.size == 1 && it.parameterTypes[0] == Boolean::class.javaPrimitiveType
        }
    }
    private val fef0Ctor: Constructor<*>? = r.fef0.declaredConstructors.firstOrNull {
        it.parameterTypes.size == 9
    }
    private val a9hCtor: Constructor<*>? = r.a9h.declaredConstructors.firstOrNull {
        it.parameterTypes.size == 2 && it.parameterTypes[0] == r.fef0 && it.parameterTypes[1] == r.bff0
    }

    private fun ctor(c: Class<*>, vararg types: Class<*>): Constructor<*> =
        c.getDeclaredConstructor(*types)

    /** LyricsResult → a9h(宿主进程对象) */
    fun build(res: LyricsResult, translation: Boolean = true): Any {
        val lines = ArrayList<Any>()
        for (l in res.lines) {
            val sync = if (res.syncType == LyricsResult.SyncType.WORD && l.words.isNotEmpty()) {
                ArrayList<Any>().also { arr ->
                    for (w in l.words) arr += cef0Ctor.newInstance(w.startMs.toInt(), w.text.length)
                }
            } else ArrayList()
            lines += aef0Ctor.newInstance(l.startMs, l.text, sync)
        }

        /* 翻译:translatedText 逐行 → 单个 def0;语言码用服务器语言或 "translated" */
        val translations = ArrayList<Any>()
        if (translation) {
            val translated = res.lines.map { it.translatedText ?: "" }
            if (translated.any { it.isNotEmpty() }) {
                val lang = res.translationLangs.firstOrNull { it != "romaji" } ?: "zhs"
                translations += def0Ctor.newInstance(lang, translated, false)
            }
        }

        val provider = bef0Ctor.newInstance(res.providerId.ifEmpty { res.provider }, res.provider, res.displayName)
        val vocalRemoval = eef0Ctor?.newInstance(false) ?: defaultInstance(eef0Type)
        val colors = bff0Ctor.newInstance(
            0xFF353535.toInt(), 0xFF565656.toInt(), 0xFFFFFFFF.toInt(), 0xFFCDCDCD.toInt(), 0xFF1ED760.toInt(), true)

        val syncType = res.syncType.domainValue
        val capStatus = 2 // UNCAPPED
        val transLangs = res.translationLangs

        if (a9hEasyCtor != null) {
            return a9hEasyCtor.newInstance(lines, syncType, translations, res.language,
                res.isRtl, provider, vocalRemoval, capStatus, transLangs, colors)
        }

        /* 退化路径:fef0 + a9h(fef0,bff0) */
        val fef0 = fef0Ctor?.newInstance(lines, syncType, translations, res.language,
            res.isRtl, provider, vocalRemoval, capStatus, transLangs)
            ?: throw IllegalStateException("fef0 ctor not found")
        return a9hCtor?.newInstance(fef0, colors)
            ?: throw IllegalStateException("a9h ctor not found")
    }

    private fun defaultInstance(cls: Class<*>?): Any {
        cls ?: throw IllegalStateException("eef0 missing")
        /* proto 生成的类有静态 DEFAULT_INSTANCE;领域类则直接构造 */
        return try {
            val f = cls.getDeclaredField("DEFAULT_INSTANCE"); f.isAccessible = true; f.get(null)!!
        } catch (_: Throwable) {
            cls.declaredConstructors.first { it.parameterTypes.isEmpty() }.newInstance()
        }
    }
}
