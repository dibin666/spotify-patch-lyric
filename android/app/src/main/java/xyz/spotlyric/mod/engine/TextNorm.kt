package xyz.spotlyric.mod.engine

import java.text.Normalizer

/* 文本归一化与相似度 —— src/core.js 的 Kotlin 移植。
 * 繁→简折叠 + 假名罗马化 + NFKC 小写 + 词元序列,保证跨语言元数据可比。 */
object TextNorm {

    private var t2s: HashMap<Char, Char>? = null

    fun toSimplified(text: String): String {
        if (!text.any { it in '一'..'鿿' }) return text
        var m = t2s
        if (m == null) {
            m = HashMap(T2S_FROM.length)
            for (i in T2S_FROM.indices) m[T2S_FROM[i]] = T2S_TO[i]
            t2s = m
        }
        val sb = StringBuilder(text.length)
        for (ch in text) sb.append(m[ch] ?: ch)
        return sb.toString()
    }

    /* ---- 假名 → 罗马音(与 core.js KANA/SMALL_Y/SMALL_V 一致) ---- */
    private val KANA = mapOf(
        'あ' to "a", 'い' to "i", 'う' to "u", 'え' to "e", 'お' to "o",
        'か' to "ka", 'き' to "ki", 'く' to "ku", 'け' to "ke", 'こ' to "ko",
        'が' to "ga", 'ぎ' to "gi", 'ぐ' to "gu", 'げ' to "ge", 'ご' to "go",
        'さ' to "sa", 'し' to "shi", 'す' to "su", 'せ' to "se", 'そ' to "so",
        'ざ' to "za", 'じ' to "ji", 'ず' to "zu", 'ぜ' to "ze", 'ぞ' to "zo",
        'た' to "ta", 'ち' to "chi", 'つ' to "tsu", 'て' to "te", 'と' to "to",
        'だ' to "da", 'ぢ' to "ji", 'づ' to "zu", 'で' to "de", 'ど' to "do",
        'な' to "na", 'に' to "ni", 'ぬ' to "nu", 'ね' to "ne", 'の' to "no",
        'は' to "ha", 'ひ' to "hi", 'ふ' to "fu", 'へ' to "he", 'ほ' to "ho",
        'ば' to "ba", 'び' to "bi", 'ぶ' to "bu", 'べ' to "be", 'ぼ' to "bo",
        'ぱ' to "pa", 'ぴ' to "pi", 'ぷ' to "pu", 'ぺ' to "pe", 'ぽ' to "po",
        'ま' to "ma", 'み' to "mi", 'む' to "mu", 'め' to "me", 'も' to "mo",
        'や' to "ya", 'ゆ' to "yu", 'よ' to "yo",
        'ら' to "ra", 'り' to "ri", 'る' to "ru", 'れ' to "re", 'ろ' to "ro",
        'わ' to "wa", 'ゐ' to "i", 'ゑ' to "e", 'を' to "o", 'ん' to "n", 'ゔ' to "vu", 'ゎ' to "wa",
    )
    private val SMALL_Y = mapOf('ゃ' to "ya", 'ゅ' to "yu", 'ょ' to "yo")
    private val SMALL_V = mapOf('ぁ' to "a", 'ぃ' to "i", 'ぅ' to "u", 'ぇ' to "e", 'ぉ' to "o")
    private val HAS_KANA = Regex("[ぁ-ヿ]")

    fun romanize(text: String): String {
        val out = StringBuilder()
        var double = false
        for (raw in text) {
            var ch = raw
            val code = ch.code
            if (code in 0x30A1..0x30F6) ch = Char(code - 0x60) // カタカナ → ひらがな
            if (ch == 'っ') { double = true; continue }
            if (ch == 'ー') {
                val m = Regex("[aeiou]$").find(out)
                if (m != null) out.append(m.value[0])
                continue
            }
            val smallY = SMALL_Y[ch]
            if (smallY != null && Regex("[a-z]i$").containsMatchIn(out)) {
                val tail = out.substring(out.length - 1)
                val prefix = out.substring(out.length - 2)
                out.delete(out.length - 2, out.length)
                out.append(if (prefix in listOf("sh", "ch", "ji")) smallY.substring(1) else smallY)
                continue
            }
            val smallV = SMALL_V[ch]
            if (smallV != null && Regex("[a-z][aeiou]$").containsMatchIn(out)) {
                out.deleteCharAt(out.length - 1)
                out.append(smallV)
                continue
            }
            val roman = KANA[ch] ?: smallY ?: smallV
            if (roman == null) { out.append(ch); double = false; continue }
            if (double) { out.append(if (roman.startsWith("ch")) 't' else roman[0]); double = false }
            out.append(roman)
        }
        return out.toString()
    }

    private val WORD_RUN = Regex("[\\p{L}\\p{N}\\p{M}]+")

    fun normalize(text: String?): String {
        if (text.isNullOrEmpty()) return ""
        val folded = toSimplified(
            Normalizer.normalize(text, Normalizer.Form.NFKC).lowercase()
        )
        return WORD_RUN.findAll(folded).joinToString(" ") { it.value }
    }

    /* ō/ou/o、wo/o 等拼写差异:去变音符 + 叠元音折叠(与 latinKey 一致) */
    private fun latinKey(text: String): String =
        Normalizer.normalize(normalize(text), Normalizer.Form.NFD)
            .replace(Regex("\\p{M}+"), "")
            .replace(Regex("([aeiou])\\1+"), "$1")
            .replace("ou", "o").replace(" ", "")

    fun textSimilarity(left: String?, right: String?): Double {
        val base = editSimilarity(normalize(left), normalize(right))
        if (base == 1.0 || !(HAS_KANA.containsMatchIn(left ?: "") || HAS_KANA.containsMatchIn(right ?: ""))) return base
        return maxOf(base, editSimilarity(latinKey(romanize(normalize(left))), latinKey(romanize(normalize(right)))))
    }

    fun editSimilarity(a: String, b: String): Double {
        if (a.isEmpty() || b.isEmpty()) return 0.0
        if (a == b) return 1.0
        val ac = a.toCharArray(); val bc = b.toCharArray()
        var row = IntArray(bc.size + 1) { it }
        for (i in 1..ac.size) {
            var prev = row[0]; row[0] = i
            for (j in 1..bc.size) {
                val t = row[j]
                row[j] = minOf(row[j] + 1, row[j - 1] + 1, prev + if (ac[i - 1] == bc[j - 1]) 0 else 1)
                prev = t
            }
        }
        return 1.0 - row[bc.size].toDouble() / maxOf(ac.size, bc.size)
    }

    /* 歌词行比对键:去注音/空白/标点(lyricKey 一致) */
    fun lyricKey(text: String?): String = (text ?: "")
        .replace(Regex("[（(][^（）()]*[)）]"), "")
        .replace(Regex("[\\s　]+"), "")
        .replace(Regex("[!！?？。、，,.・…~～ー\\-—'’'\"“”‘’♪♡♥]"), "")

    private val CJK = Regex("[぀-ヿ㐀-鿿가-힯]")
    private val LATIN = Regex("[a-zA-Z]")

    fun scriptsDiffer(left: String?, right: String?): Boolean {
        val a = left ?: ""; val b = right ?: ""
        if (a.isEmpty() || b.isEmpty()) return false
        return (CJK.containsMatchIn(a) && !CJK.containsMatchIn(b) && LATIN.containsMatchIn(b)) ||
               (CJK.containsMatchIn(b) && !CJK.containsMatchIn(a) && LATIN.containsMatchIn(a))
    }
}
