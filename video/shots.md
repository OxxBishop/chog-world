# Demo video shots

Each shot is a link that plays a fixed camera path or cutscene at a fixed hour, with the interface hidden.
The code is `src/shots.js` (the shots) and `src/democlock.js` (the clock a take runs on).

## Watching one

`https://chog-world.vercel.app/?demo=<shot>` plays it live, in real time. Add `&q=high` for full quality.

## Capturing one, frame by frame

Open `?demo=<shot>&capture&q=high` (1920x1080 viewport), then:

```js
await chogDemo.ready;                 // set up, first frame drawn
for (let i = 0; i <= fps * chogDemo.duration; i++) {
  await chogDemo.at(i / fps);         // the whole world at that second, drawn
  // screenshot here
}
```

- `chogDemo.at(s)` sets everything to second `s` and draws it: the camera, the sun, the clouds, the Chogs about town, the cutscenes, and the page's own animations and captions. It resolves once the frame is on the canvas.
- Every frame is exactly `1/fps` of shot time after the last, at any frame rate, however long the GPU takes to draw it.
- Takes repeat: the shot's random moments are seeded, and it waits for any download before moving on. (The bar's lines can differ while the Chog brain is up, since it writes them fresh.)
- Takes run forward. Asking for an earlier second reloads the page at it. `&at=12.5` opens a take at 12.5 s, handy for a single still.
- Speed: headless Chrome in the cloud (SwiftShader, no GPU) takes 1 to 2 s a frame at 960x540, so a long capture is better run on the laptop, whose GPU should be many times faster.

## The shots

| Shot | Length | Hour | What it shows |
| --- | --- | --- | --- |
| `overview` | 32 s | 17:30 | B5's opening flight. In from the south over the sea of clouds at golden hour, low over the first neighbourhood's domes, up the walk to the fountain and the Hub, then a rising pull back to the whole archipelago. `opening` is the same shot. |
| `arrival` | 21 s | 16:30 | The way in. The loading screen fills (0 to 2.6 s), the connect screen comes up over the world seen from space (2.9 s), the demo Chog's button is pressed (4.8 s), its welcome, the screen tears away (about 7 s), the flight down into its dome (7 to 13 s), and it steps out of its pod and says hello (about 14 s). |
| `entry` | 9 s | 20:30 | A room entry. From the Hub at night through the casino's door (1 s), inside by about 4.5 s, the machines' lights rippling on. |
| `bar` | 30 s | 21:00 | Into the bar (0.8 s), where two regulars chat at the counter, a line at a time, each with its mood. Lines from about 6 s. The lines come from the Chog brain when it is up, otherwise from the regulars' own. |
| `jackpot` | 12 s | 20:00 | At the slot machine. The spin (1 s), three Chogs land (about 2.6 s), JACKPOT in lights with chips raining and the casino's own cutscene round the room (3 to 8.5 s), back at the machine with the win counted up. |
| `sale` | 21 s | 15:00 | The demo Chog at home is sold (1.5 s). It turns to you, goes grey from the feet up (3 to 5.5 s) and walks off (6 to 8.5 s), the view is carried out to space, "Your Chog has moved on." (about 16 s), and the world comes back (about 19 s). |
| `space` | 18 s | 12:30 to 13:30 | The world from space. The view pulls back from the Hub, out past the clouds (0.8 to 7.8 s), to the archipelago turning slowly in the dark. |

Total: 2 min 23 s of material.
