# Chog World

A living world where your Chog comes alive, learns from you, and becomes your little buddy.

Chog World floats in the sky above a sea of clouds. Downtown sits in the middle with Chog Hub, the café where every Chog can grab a seat. Bridges lead out to neighbourhood islands, where each Chog has its own dome with a garden and a small modern home. The sky follows your real time of day, and at night a purple aurora rolls in.

Chogathon 2026 entry.

## Status

Early build. The world is in: the floating islands over a volumetric sea of clouds, downtown and Chog Hub, three neighbourhoods of domes, bridges, waterfalls, drifting rocks, day and night, and the aurora. Chogs, wallet sign-in and chat come next.

## Run it

```
npm install
npm run dev
```

Then open http://localhost:5173.

Controls: swipe or drag to look around, two fingers or right-drag to move, pinch or scroll to zoom. Tap a place to visit it, tap again to leave. Add `?view=dome&hour=22` to the address to jump to a view and a time.

Quality: the world runs at full quality by default. On a slower machine, add `?q=medium` or `?q=low` to the address. `?q=auto` adjusts as you go.

## Credits

Models and inspiration are listed in [CREDITS.md](CREDITS.md). Look and feel inspired by [Bot Crossing](https://github.com/Station-Sciences/bot-crossing). All code here is new.
