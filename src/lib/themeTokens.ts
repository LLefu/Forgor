/** Plugin theme presets (plugins/themes.ts). No imports, so validate.ts can use it too. */

/** The color tokens a theme may set (CSS variables on <html>, see index.css). */
export const THEME_TOKENS = [
  "background",
  "foreground",
  "sidebar",
  "muted",
  "muted-foreground",
  "border",
  "input",
  "ring",
  "accent",
  "accent-foreground",
  "primary",
  "primary-foreground",
  "destructive",
  "success",
  "warning",
  "popover",
  "p1",
  "p2",
  "p3",
  "p4",
] as const;

export type ThemeToken = (typeof THEME_TOKENS)[number];

/** "--background" and "background" are both fine in a plugin's tokens. */
export const tokenName = (key: string) => key.replace(/^--/, "");
