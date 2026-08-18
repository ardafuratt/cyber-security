# Obsidian Security — Scroll-Scrub Landing Page

Scroll-driven video landing page for a cybersecurity brand. Vanilla HTML, CSS, and JavaScript.

## Run locally

```bash
npx serve . -l 4173
```

Open `http://localhost:4173` (do not use `file://` — video seek requires HTTP range requests).

For phone testing on the same Wi‑Fi:

```bash
npx serve . -l tcp://0.0.0.0:4173
```

Then open `http://<your-lan-ip>:4173` on your phone.

## Stack

- `index.html` — structure & content
- `style.css` — design tokens, scroll stage, mobile layout
- `script.js` — scroll → `video.currentTime` sync
- `assets/` — video, posters, section images
