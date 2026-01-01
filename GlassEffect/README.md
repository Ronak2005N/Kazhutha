Glass Effect Theme
==================

This folder contains a purely visual, optional "Glass Effect" theme for the Kazhutha UI.

- `glass.css` — scoped styles applied when `body` has `.glass-theme`.
- `glass.js`  — minimal toggle logic. Clicking the "Theme" menu item prevents navigation and toggles the class on `body`.

Design goals:
- Apple-style glassmorphism (blur + translucency)
- No changes to game logic or layout
- No external libraries or assets

Usage:
- Click the "Theme" menu item to toggle the glass theme on/off. Preference is persisted in `localStorage`.
