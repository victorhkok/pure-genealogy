// 长辈友好的个性化显示设置。纯客户端，localStorage 持久化。
// 主题沿用 next-themes，这里只负责字号 / 高对比 / 长辈模式。

export type FontScale = "normal" | "large" | "xlarge";
export type ContrastMode = "normal" | "high";
export type ThemeChoice = "light" | "dark" | "system";

export interface AppearanceSettings {
  fontScale: FontScale;
  contrast: ContrastMode;
  elderMode: boolean;
  theme: ThemeChoice;
}

export const APPEARANCE_KEY = "genealogy.appearance.v1";

export const DEFAULT_APPEARANCE: AppearanceSettings = {
  fontScale: "normal",
  contrast: "normal",
  elderMode: false,
  theme: "system",
};

export const FONT_SCALE_LABELS: Record<FontScale, string> = {
  normal: "标准",
  large: "大字号",
  xlarge: "超大字号",
};

export function readAppearance(): AppearanceSettings {
  if (typeof window === "undefined") return DEFAULT_APPEARANCE;
  try {
    const raw = window.localStorage.getItem(APPEARANCE_KEY);
    if (!raw) return DEFAULT_APPEARANCE;
    const parsed = JSON.parse(raw) as Partial<AppearanceSettings>;
    return {
      fontScale: (["normal", "large", "xlarge"] as string[]).includes(parsed.fontScale ?? "")
        ? (parsed.fontScale as FontScale)
        : "normal",
      contrast: parsed.contrast === "high" ? "high" : "normal",
      elderMode: Boolean(parsed.elderMode),
      theme: (["light", "dark", "system"] as string[]).includes(parsed.theme ?? "")
        ? (parsed.theme as ThemeChoice)
        : "system",
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

/** 把设置直接写到 <html>，供 CSS 选择器读取。 */
export function applyAppearanceToDom(s: AppearanceSettings): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const scale = s.elderMode ? "xlarge" : s.fontScale;
  root.dataset.fontScale = scale;
  root.dataset.contrast = s.elderMode ? "high" : s.contrast;
  root.dataset.elder = s.elderMode ? "on" : "off";
  try {
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(s));
  } catch {
    // 隐私模式下 localStorage 不可写，忽略即可，当前会话仍生效。
  }
}

/** 首屏防闪烁：在 <head> 里同步执行，早于 React hydrate。 */
export const APPEARANCE_BOOTSTRAP = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  APPEARANCE_KEY,
)})||'{}');var e=s.elderMode;var f=e?'xlarge':(s.fontScale||'normal');var c=e?'high':(s.contrast||'normal');var d=document.documentElement;d.dataset.fontScale=f;d.dataset.contrast=c;d.dataset.elder=e?'on':'off';}catch(err){}})();`;
