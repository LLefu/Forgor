/**
 * Highlight (accent) colors. Each has a shade for light mode and one for dark
 * mode, plus the text color that reads well on top of it. The softer
 * highlight backgrounds (--accent) are derived from --primary in index.css.
 */
export interface Accent {
  id: string;
  label: string;
  light: string;
  dark: string;
  /** Text on a solid primary button in dark mode (bright shades need dark text). */
  darkForeground?: string;
}

export const ACCENTS: Accent[] = [
  { id: "indigo", label: "Indigo", light: "#4f46e5", dark: "#6366f1" },
  { id: "violet", label: "Violet", light: "#7c3aed", dark: "#8b5cf6" },
  { id: "fuchsia", label: "Fuchsia", light: "#c026d3", dark: "#d946ef" },
  { id: "pink", label: "Pink", light: "#db2777", dark: "#ec4899" },
  { id: "rose", label: "Rose", light: "#e11d48", dark: "#f43f5e" },
  { id: "orange", label: "Orange", light: "#ea580c", dark: "#f97316" },
  { id: "amber", label: "Amber", light: "#b45309", dark: "#f59e0b", darkForeground: "#1c1917" },
  { id: "lime", label: "Lime", light: "#4d7c0f", dark: "#a3e635", darkForeground: "#1a2e05" },
  { id: "emerald", label: "Emerald", light: "#059669", dark: "#10b981" },
  { id: "teal", label: "Teal", light: "#0f766e", dark: "#14b8a6", darkForeground: "#042f2e" },
  { id: "cyan", label: "Cyan", light: "#0e7490", dark: "#22d3ee", darkForeground: "#083344" },
  { id: "sky", label: "Sky", light: "#0284c7", dark: "#38bdf8", darkForeground: "#082f49" },
  { id: "blue", label: "Blue", light: "#2563eb", dark: "#3b82f6" },
  { id: "graphite", label: "Graphite", light: "#3f3f46", dark: "#d4d4d8", darkForeground: "#18181b" },
];

export const DEFAULT_ACCENT = "indigo";

export function getAccent(id: string): Accent {
  return ACCENTS.find((a) => a.id === id) ?? ACCENTS[0];
}
