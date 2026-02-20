# Gen's World! 🎨💖

**Gen's World! Pixel Pulse Atelier** is a retro 8-bit HTML5 painting game/toy designed for smooth 60 FPS play on desktop and mobile (including iOS Safari).

## What it is
- A single-canvas pixel painter with pulsating RGB color animation
- 8-bit CRT vibe inspired by classic arcade aesthetics
- Mobile-first paint interaction (tap/drag directly on canvas)
- Chill progression: stroke milestones, gem counters, unlockable palettes, and Gen-themed secret messages

## Features
- **Performance-focused renderer**
  - Fixed timestep loop (`requestAnimationFrame` + fixed updates)
  - Typed arrays for paint grid and particle pool
  - Offscreen pixel buffer for the paint layer
  - Optional **Performance mode**
- **Art style + effects**
  - Retro palette sets with pulse animation
  - CRT scanline toggle
  - Pixel geometry inspired by classic 8-bit arcade framing
- **Controls**
  - Pointer/touch drawing for iOS/mobile
  - Keyboard shortcuts for desktop
- **Audio**
  - WebAudio chiptune loop + paint/unlock SFX
  - Autoplay-safe start gesture
- **Accessibility basics**
  - Reduced motion toggle
  - High contrast toggle
  - Mute + volume
  - FPS overlay toggle

## Run locally
Open `index.html` directly in a browser.

If audio does not start immediately, press **Tap to Wake Audio + Start** first (required by browser audio policy).

## Deploy on GitHub Pages
1. Push these files to your repository root (`index.html`, `style.css`, `game.js`, `README.md`).
2. In GitHub repo settings, open **Pages**.
3. Set source to your branch root.
4. Save.

No build step. No npm. No external libraries.

## Quick Controls
- **Touch/iOS:** tap + drag to paint
- **Keyboard:**
  - `1..8` select color slot
  - `[` / `]` brush size
  - `C` clear canvas
  - `P` pause
  - `F` toggle FPS
  - `M` mute

Made for Gen ✨
