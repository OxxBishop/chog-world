# Chog World: cutscenes in Flow, music and sound in Gemini (A, 10-21)

The user's call (10-21): the in-game cutscenes are redone as Flow (Veo) clips, and the island gets music and
sound. Each clip starts and ends on a real frame of the game (`video/frames/`), so it cuts into and out of
the live world without a jump. Make every clip 16:9 at 1080p **and** 9:16 for phones (same prompt, the
portrait frames). No text, logos or UI in any clip: the game draws its own.

## How each clip is used in the game

| Clip | Plays when | Start frame | End frame | Length |
|---|---|---|---|---|
| `arrival` | after picking a Chog on the connect screen | `planet` (space, the purple planet) | `overview` (the islands from above) | 8 s |
| `homecoming` | the arrival's last leg, down to your dome | `overview` | `dome` (your dome's door, close) | 6 s |
| `departure` | sign out, and after a sale | `overview` | `planet` | 6 s |
| `portal` | stepping through a portal | `pad` (a portal pad, close) | `pad2` (another pad) | 4 s |

The game plays the clip full screen, then fades into the live view on the end frame (the sale's grey-out stays
in-game: it has to show your own Chog).

## Style block (paste at the end of every video prompt)

> Stylised 3D animation, a soft glossy vinyl-toy world: pastel lilac sky, rounded chunky shapes, warm sunset
> light, gentle bloom. Smooth, slow, steady camera, no shaking, no cuts. No people, no text, no logos.

## Video prompts (Flow: Frames to video; start and end frames from `video/frames/`)

**arrival**
> The camera falls from deep space toward a glowing purple planet, faster and faster, streaks of starlight
> rushing past, then breaks through a layer of soft pink and lilac clouds and slows, revealing a cluster of
> floating grassy islands joined by glass bridges, with glass domes and a golden domed building in the middle,
> drifting above a sea of clouds at sunset. Ends looking down on the islands, exactly as the last frame.

**homecoming**
> The camera glides down from above the floating islands, over the treetops and the glass bridges, and
> settles in front of a large glass geodesic dome with a garden inside, slowing gently to a stop at its door.

**departure**
> The camera lifts away from the floating islands, rising faster through the soft clouds, the islands
> shrinking below, until it bursts into space and the purple planet turns slowly in view, stars streaking past
> then settling.

**portal**
> The camera dives into a swirling ring of violet and cyan light on a round stone pad, through a short tunnel
> of spinning light and stars, and comes out of an identical glowing pad on another island, the light fading.

## Music and sound (Gemini: Create music / Lyria; 48 kHz WAV or MP3)

**Island theme (loop, 90 s)**
> A cosy, dreamy lo-fi instrumental for a cute island game: soft Rhodes piano, warm marimba, light brushed
> drums, a gentle bass, airy pads, a little glockenspiel melody. Relaxed, 82 BPM, major key, wonder and calm.
> Seamless loop: the end flows back into the start. No vocals.

**Night theme (loop, 90 s)**
> The same cosy island theme at night: slower, 70 BPM, soft piano and music box, warm pads, distant chimes,
> sleepy and magical. Seamless loop. No vocals.

**The singer's song (2 minutes, with vocals)**
> A bright, catchy, cute pop song sung by a sweet, playful female voice, like a mascot idol on a small plaza
> stage: bouncy synths, claps, a hooky chorus. Lyrics:
> *Verse:* Floating on the clouds tonight / purple skies and city lights / every friend I've ever met / lives
> up here, you can't forget. *Chorus:* Chog, Chog, say hello / up where the soft winds blow / Chog, Chog, take
> my hand / welcome to our little land.

**Ambience (loop, 60 s)**
> Gentle outdoor ambience high above the clouds: soft wind, light birdsong, a faint fountain, wind chimes now
> and then. No music.

**Short sounds** (Gemini does these poorly: CC0 packs from Kenney instead, with the user's OK to download):
portal whoosh, hoverboard hum, button tap, postcard shutter, coin clink, warp boom.
