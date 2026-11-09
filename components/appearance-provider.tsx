"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { useTheme } from "next-themes";
import {
  APPEARANCE_KEY,
  DEFAULT_APPEARANCE,
  applyAppearanceToDom,
  readAppearance,
  type AppearanceSettings,
} from "@/lib/appearance";

interface AppearanceContextValue {
  settings: AppearanceSettings;
  update: (patch: Partial<AppearanceSettings>) => void;
  reset: () => void;
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null);

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<AppearanceSettings>(DEFAULT_APPEARANCE);
  const { setTheme } = useTheme();

  useEffect(() => {
    const initial = readAppearance();
    setSettings(initial);
    applyAppearanceToDom(initial);
    setTheme(initial.theme);
  }, [setTheme]);

  // 多标签页同步
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== APPEARANCE_KEY || !e.newValue) return;
      const next = readAppearance();
      setSettings(next);
      applyAppearanceToDom(next);
      setTheme(next.theme);
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [setTheme]);

  const update = useCallback(
    (patch: Partial<AppearanceSettings>) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch };
        applyAppearanceToDom(next);
        if (patch.theme) setTheme(patch.theme);
        return next;
      });
    },
    [setTheme],
  );

  const reset = useCallback(() => {
    setSettings(DEFAULT_APPEARANCE);
    applyAppearanceToDom(DEFAULT_APPEARANCE);
    setTheme(DEFAULT_APPEARANCE.theme);
  }, [setTheme]);

  return (
    <AppearanceContext.Provider value={{ settings, update, reset }}>
      {children}
    </AppearanceContext.Provider>
  );
}

export function useAppearance(): AppearanceContextValue {
  const ctx = useContext(AppearanceContext);
  if (!ctx) throw new Error("useAppearance 必须在 AppearanceProvider 内使用");
  return ctx;
}
