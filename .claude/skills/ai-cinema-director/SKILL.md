---
name: ai-cinema-director
description: Directing Chog World's cutscenes and camera moves in film language - shot sizes, lenses as field of view, dolly, crane and tilt paths, pacing, framing round the UI on a laptop and a phone. Use when designing or reviewing any cutscene (arrival, wake-up, warp, room entries, the casino's jackpot, the sale) before writing its timeline.
---

# Directing the camera in Chog World

Before you code a cutscene, write it as a **shot list**. Each beat gets a shot size, a lens, a move, a time and the reason for it. Then write the timeline from it (see js-timeline-and-easing-orchestrator).

## Lenses as field of view

three.js uses the vertical field of view. On a 24 mm-high full-frame sensor: `fov = 2 * atan(12 / f)` in degrees.

| Focal length | Vertical FOV | Use |
|---|---|---|
| 18 mm | 67 deg | inside small rooms, phones in portrait (64 deg is the indoor tall default) |
| 24 mm | 53 deg | the world's default feel (indoor wide is 52 deg) |
| 35 mm | 38 deg | characters in their place |
| 50 mm | 27 deg | faces, a Chog saying hello |
| 85 mm | 16 deg | a detail, a reveal, compressed distance |

A warp kick of +30 deg reads as speed. A snap back with a small overshoot reads as arrival.

## Shot vocabulary

- **Sizes:** extreme wide (the whole planet, the archipelago), wide (a dome), medium (a Chog and its pod), close (a face, the reels).
- **Moves:**
  - dolly: the camera travels toward or away
  - truck: sideways
  - crane, pedestal: up or down
  - pan, tilt: the camera turns in place
  - roll: dutch, for unease or a daze
  - push-in: a slow dolly toward the subject, for emphasis
- **Motivate every move:** the camera follows a look, a sound or a character, or reveals something. An unmotivated move reads as a bug.
- **Anticipation, action, settle:** a small move the other way, the move, then a short overshoot or drift that dies away.

## Composition rules here

- **The UI is part of the frame.** On a laptop the casino panel takes the right quarter, so subjects sit left of centre. On a phone the bar takes the bottom third, so subjects sit high. Check both every time.
- **Thirds and headroom:** eyes on the upper third line; leave lead room in the direction of a look or a move.
- **The 180-degree rule:** in a back-and-forth between two subjects (you and your Chog), stay on one side of the line between them.
- **Hide every swap behind a cover:** a flash, a blank, a door or a tunnel. One hard cut per sequence at most, and only on a beat.

## Pacing

- A beat the eye must read (a title, a face): at least 1.5 to 2 s.
- A transition: 0.3 to 0.8 s. A whole cutscene in this game: 4 to 8 s. Skippable (a tap or Esc) once it's longer than about 3 s.

## The arrival, as directed (B25)

| Beat | Time | Shot |
|---|---|---|
| Title | about 1.8 s | Extreme wide on the planet, the title over the upper limb. |
| Lunge | 0.7 to 2.2 s | A push-in that becomes a dive. FOV 50 to 76 deg. Streaks, a pink glow of entry. |
| White | 0.4 s | Hold, then blank. |
| Wake | | POV from the grass, looking up at the glass (wide, 18 to 24 mm feel). Lids open a slit, blink, open; dutch roll and drifting gaze; the image swims with blur. |
| Sit up | 2 s | Crane up and tilt down onto the pod door, roll easing out. |
| Hello | | A's Chog comes out and waves, framed medium. |
