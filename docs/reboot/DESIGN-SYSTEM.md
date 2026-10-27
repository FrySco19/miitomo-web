# Reboot design system (R6.0)

One set of tokens and components for every Reboot surface: the Reboot panel, the Piazza, places, the Sala Giochi,
the MiiPhone and its apps. Classic (`?reboot=0`) never loads it: the stylesheet travels in the Reboot chunk.

Source: `client/web/src/reboot/ui/tokens.css`. It is imported first by `reboot/index.ts`, so every Reboot stylesheet
can use the variables.

All the visuals are **new**. No Nintendo images, fonts, textures or UI were copied. The font stack starts with the
font the Classic client already uses (`--pl-font`, from the user's own files) and falls back to system rounded fonts.

## Tokens (`--r-*`)

| Group | Tokens | Notes |
|---|---|---|
| Colour | `cream`, `cream-2/3`, `surface`, `surface-2/3`, `line`, `line-2` | Warm cream backgrounds and white cards |
| Text | `ink` (11.6:1), `ink-2` (5.9:1), `ink-3` (4.7:1) | `ink-3` is the lightest colour allowed for text |
| Accent | `accent` #cc4b12 (4.6:1 with white text), `accent-hi` #ff7a2f | `accent-hi` is decorative only: the phone body, icons. Never put small text on it |
| Hues | `blue`, `purple`, `pink`, `green`, `danger` (each with `-hi` and `-soft`) | Used for kinds of places and actions |
| Type | `font`, `fs-xs` … `fs-3xl`, `fw`, `lh` | |
| Space | `s1` 4px … `s6` 32px | |
| Shape | `r-sm` … `r-xl`, `r-pill`; `shadow-key`, `shadow-press`, `shadow-card`, `shadow-float`; `focus` | |
| Motion | `fast` 120ms, `med` 220ms, `slow` 360ms; `ease`, `ease-pop` | All three durations become 1ms when motion is reduced |
| Layers | `z-bar`, `z-hub`, `z-scrim`, `z-phone`, `z-dock`, `z-toast` | |

Contrast ratios are measured on `--r-cream`. Text colours meet WCAG AA (at least 4.5:1).

## Reduced motion

Motion is reduced when:

- the OS asks for reduced motion (`prefers-reduced-motion`), unless Settings → Animations is set to **All**;
- or `<html data-motion="reduced">` is set. Reboot sets it from Settings (Reduced, or light mode).

## Components

| Class | Use |
|---|---|
| `.r-btn` (+ `primary`, `blue`, `purple`, `danger`, `ghost`, `sm`, `lg`) | Every button |
| `.r-card` | White rounded card |
| `.r-chip` (+ `ok`, `bad`) | Small status labels (open, full…) |
| `.r-tabs`, `.r-seg` | Tabs, segmented choice (`aria-pressed`) |
| `.r-row`, `.r-list` | Lists of rows |
| `.r-avatar` `p0`–`p3` | Initial in a circle, coloured by personality |
| `.r-field`, `.r-input` | Labelled text fields and selects |
| `.r-toggle`, `.r-range` | Switch (a real checkbox) and slider |
| `.r-empty`, `.r-note`, `.r-msg` | Empty state, small print, status line |
| `.r-toast`, `.r-spin`, `.r-sr` | Toast, spinner, screen-reader-only text |
| `.r-h`, `.r-sub`, `.r-badge` | Titles and the "REBOOT · new" badge |

Elements inside a `[data-reboot]` layer get the shared `:focus-visible` ring.

## MiiPhone home

The home screen shows:

- a status line with the time and date, written for the language and region;
- a 4-column grid of app tiles. Each tile has the app's own colour and an optional number badge;
- the Reboot note.

Only implemented apps are shown. There are no placeholder tiles.
