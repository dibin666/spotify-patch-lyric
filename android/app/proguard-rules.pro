# libxposed:模块入口类必须保留,混淆时同步改写 java_init.list
-dontwarn io.github.libxposed.annotation.**
-adaptresourcefilecontents META-INF/xposed/java_init.list
-keep,allowoptimization,allowobfuscation public class * extends io.github.libxposed.api.XposedModule {
    public <init>();
}

# 引擎/数据模型在 hook 进程内运行,防止被裁剪
-keep class xyz.spotlyric.mod.engine.** { *; }
-keep class xyz.spotlyric.mod.module.** { *; }
-keep class xyz.spotlyric.mod.data.** { *; }
-dontwarn io.reactivex.rxjava3.**
