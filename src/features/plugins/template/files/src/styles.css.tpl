/*
 * Your plugin's CSS. The app has no classes for your plugin, so Tailwind builds
 * the utilities you use here, against Forgor's theme: bg-background,
 * text-muted-foreground, border, bg-primary, rounded… follow light/dark mode
 * and the user's highlight color. No reset here: the app already has one.
 */
@import "tailwindcss/theme" theme(reference);
@import "../forgor/theme.css";
@import "tailwindcss/utilities" source("./");
