import { useState, useEffect } from "react";

export type Theme = "light" | "dark" | "system";

function getResolvedTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem("theme") as Theme) || "system"
  );

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", getResolvedTheme(theme));
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      document.documentElement.setAttribute("data-theme", getResolvedTheme("system"));
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const cycleTheme = () => {
    setTheme((prev) => {
      if (prev === "system") return "light";
      if (prev === "light") return "dark";
      return "system";
    });
  };

  return { theme, setTheme, cycleTheme };
}
