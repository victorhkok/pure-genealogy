"use client";

import { useAppearance } from "@/components/appearance-provider";
import {
  FONT_SCALE_LABELS,
  type FontScale,
  type ThemeChoice,
} from "@/lib/appearance";

const optionCls =
  "flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors hover:bg-muted";
const activeCls = "border-primary bg-primary/5 font-medium";

export function AppearanceForm() {
  const { settings, update, reset } = useAppearance();

  const elder = settings.elderMode;
  const fontScales: FontScale[] = ["normal", "large", "xlarge"];
  const themes: { value: ThemeChoice; label: string; hint: string }[] = [
    { value: "light", label: "浅色", hint: "白天、光线充足" },
    { value: "dark", label: "深色", hint: "夜间、减少刺眼" },
    { value: "system", label: "跟随系统", hint: "与设备一致" },
  ];

  return (
    <div className="space-y-7">
      <div>
        <h2 className="text-lg font-semibold">显示与易用</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          设置只保存在这台设备的浏览器里，立即生效，换设备需重新设置。
        </p>
      </div>

      {/* 一键长辈模式 */}
      <section className="rounded-lg border p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={elder}
            onChange={(e) => update({ elderMode: e.target.checked })}
          />
          <span>
            <span className="block text-sm font-medium">长辈模式（一键开启）</span>
            <span className="block text-xs text-muted-foreground mt-1">
              同时启用超大字号、高对比度、加大按钮与点击区、加宽行距。适合长时间阅读谱书。
            </span>
          </span>
        </label>
      </section>

      {/* 字号 */}
      <section className="rounded-lg border p-4">
        <h3 className="mb-1 text-sm font-medium">字体大小</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          {elder ? "长辈模式已锁定为超大字号，关闭长辈模式后可单独调整。" : "整站文字按比例放大。"}
        </p>
        <div className="flex flex-wrap gap-2">
          {fontScales.map((f) => (
            <button
              key={f}
              type="button"
              disabled={elder}
              onClick={() => update({ fontScale: f })}
              className={
                optionCls +
                " disabled:cursor-not-allowed disabled:opacity-50 " +
                ((elder ? "xlarge" : settings.fontScale) === f ? activeCls : "")
              }
            >
              <span style={{ fontSize: f === "normal" ? 14 : f === "large" ? 17 : 20 }}>Aa</span>
              {FONT_SCALE_LABELS[f]}
            </button>
          ))}
        </div>
      </section>

      {/* 主题 */}
      <section className="rounded-lg border p-4">
        <h3 className="mb-3 text-sm font-medium">主题</h3>
        <div className="flex flex-wrap gap-2">
          {themes.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => update({ theme: t.value })}
              className={optionCls + " " + (settings.theme === t.value ? activeCls : "")}
            >
              <span className="flex flex-col items-start">
                <span>{t.label}</span>
                <span className="text-xs text-muted-foreground">{t.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {/* 高对比 */}
      <section className="rounded-lg border p-4">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4"
            checked={elder || settings.contrast === "high"}
            disabled={elder}
            onChange={(e) => update({ contrast: e.target.checked ? "high" : "normal" })}
          />
          <span>
            <span className="block text-sm font-medium">高对比度</span>
            <span className="block text-xs text-muted-foreground mt-1">
              加深文字与边框、给链接加下划线，减轻老花与弱视的阅读负担。
            </span>
          </span>
        </label>
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="rounded-md border px-4 py-2 text-sm hover:bg-muted"
        >
          恢复默认
        </button>
        <span className="text-xs text-muted-foreground">当前：{elder ? "长辈模式" : FONT_SCALE_LABELS[settings.fontScale]} · {themes.find((t) => t.value === settings.theme)?.label} · {elder || settings.contrast === "high" ? "高对比" : "标准对比"}</span>
      </div>
    </div>
  );
}
