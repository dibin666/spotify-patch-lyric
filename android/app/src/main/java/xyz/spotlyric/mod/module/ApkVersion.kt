package xyz.spotlyric.mod.module

import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.zip.ZipFile

/**
 * 直接解析 APK 内 AndroidManifest.xml(二进制 AXML)取 versionCode/versionName。
 * onPackageReady 阶段没有 Context,无法走 PackageManager。
 */
object ApkVersion {

    /* android: attr 资源 ID(framework public.xml 固定值) */
    private const val RES_VERSION_CODE = 0x0101021b
    private const val RES_VERSION_NAME = 0x0101021c

    fun read(apkPath: String): Pair<Long, String> {
        try {
            ZipFile(apkPath).use { z ->
                val e = z.getEntry("AndroidManifest.xml") ?: return 0L to ""
                z.getInputStream(e).use { return parse(it.readBytes()) }
            }
        } catch (_: Throwable) { }
        return 0L to ""
    }

    /* ---------- 极简二进制 AXML 解析 ---------- */

    private fun parse(d: ByteArray): Pair<Long, String> {
        val b = ByteBuffer.wrap(d).order(ByteOrder.LITTLE_ENDIAN)
        if (d.size < 8 || b.short.toInt() and 0xffff != 0x0003) return 0L to ""
        val strings = ArrayList<String>()
        var resIds = IntArray(0)
        var versionCode = 0L
        var versionName = ""

        while (b.remaining() >= 8) {
            val type = b.short.toInt() and 0xffff
            val headerSize = b.short.toInt() and 0xffff
            val size = b.int
            if (size <= 0 || b.position() + size - 8 > d.size) break
            val chunkStart = b.position() - 8

            when (type) {
                0x0001 -> { /* StringPool */
                    val count = b.int
                    /* styleCount */ b.int
                    val flags = b.int
                    val stringsStart = b.int
                    /* stylesStart */ b.int
                    val utf8 = flags and (1 shl 8) != 0
                    val offsets = IntArray(count) { b.int }
                    val base = chunkStart + 8 + stringsStart
                    for (i in 0 until minOf(count, offsets.size)) {
                        val off = base + offsets[i]
                        strings += if (utf8) readUtf8Len(d, off) else readUtf16Len(d, off)
                    }
                }
                0x0180 -> { /* ResourceMap */
                    val n = (size - headerSize) / 4
                    resIds = IntArray(n) { b.int }
                }
                0x0102 -> { /* StartElement */
                    /* lineNumber */ b.int; /* comment */ b.int
                    /* ns */ b.int
                    val nameIdx = b.int
                    /* attrStart */ b.short; /* attrSize */ b.short
                    val attrCount = b.short.toInt() and 0xffff
                    /* id/class/style */ b.short; b.short; b.short
                    val tag = strings.getOrElse(nameIdx) { "" }
                    if (tag == "manifest") {
                        for (i in 0 until attrCount) {
                            /* nsIdx */ b.int
                            val attrNameIdx = b.int
                            /* rawIdx */ b.int
                            /* size */ b.short; /* res0 */ b.get()
                            val dataType = b.get().toInt() and 0xff
                            val data = b.int
                            val resId = resIds.getOrElse(attrNameIdx) { 0 }
                            when (resId) {
                                RES_VERSION_CODE -> versionCode = data.toLong() and 0xffffffffL
                                RES_VERSION_NAME -> versionName =
                                    if (dataType == 0x03) strings.getOrElse(data) { "" } else data.toString()
                            }
                        }
                        return versionCode to versionName
                    } else {
                        b.position(b.position() + attrCount * 20)
                    }
                }
            }
            b.position(chunkStart + size)
        }
        return versionCode to versionName
    }

    private fun readUtf8Len(d: ByteArray, off: Int): String {
        var i = off
        /* u16len(utf8 chars) */
        if (d[i].toInt() and 0x80 != 0) i += 2 else i += 1
        /* u8len(bytes) */
        var len: Int
        if (d[i].toInt() and 0x80 != 0) {
            len = ((d[i].toInt() and 0x7f) shl 8) or (d[i + 1].toInt() and 0xff); i += 2
        } else { len = d[i].toInt() and 0xff; i += 1 }
        return String(d, i, minOf(len, d.size - i), Charsets.UTF_8)
    }

    private fun readUtf16Len(d: ByteArray, off: Int): String {
        val bb = ByteBuffer.wrap(d, off, d.size - off).order(ByteOrder.LITTLE_ENDIAN)
        var len = bb.short.toInt() and 0xffff
        if (len and 0x8000 != 0) len = (len and 0x7fff) shl 16 or (bb.short.toInt() and 0xffff)
        return String(d, bb.position(), minOf(len * 2, d.size - bb.position()), Charsets.UTF_16LE)
    }
}
