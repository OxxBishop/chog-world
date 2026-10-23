# Chog World

A cosy 3D world in the browser where your Chog NFT comes to life. Sign in with your wallet and your Chog wakes up in its own glass dome, waves hello, and walks the islands with you. Talk to it and it remembers you.

**Live:** https://chog-world.vercel.app · Chogathon 2026 entry · Monad testnet

## What's in it

- **Your Chog, alive.** Your Chog walks the world as a rigged 3D Chog with its own face, idle, walk, run and little moods: the 11 Chogs of the cast have models of their own, and every other Chog wears the base Chog in its Skin trait's colours, hair and face as its art has them, with its own art floating over its head. It wakes up when you sign in, follows you into rooms, and says goodbye when you sign out.
- **It talks back.** Chat with your Chog from anywhere. It has a personality from its traits and keeps a memory of what you tell it.
- **A world to wander.** Floating islands over a sea of clouds: the plaza with a fountain and a singer on stage, Chog Hub, three neighbourhoods of domes, glass bridges, portals between islands, hoverboards, birds, manta rays and a whale in the sky. Real time of day, with an aurora at night.
- **A cast of Chogs, each with a place of their own.** Snooze naps under the giant tree, Patrol rides his hover chopper, King Pom holds court on his throne by the fountain, Quackers poses in a flower arch, Toasty tells stories by his campfire, Dash runs laps of the glass bridge, Peel holds up the bar. They greet you as you pass.
- **Chog Hub.** A lobby, a bar, and the Starlite Lounge casino with Chog Slots and roulette on free testnet chips. Every Chog trait gives you an edge at the tables.
- **Things to do.** Race Patrol round the first loop on a hoverboard against his chopper. Chase down twelve stars that drift round the islands like wisps and dart away as you come close; catch them all and a Chog lights up in the night sky. Help the cast with small daily asks: firewood for Toasty, Petal's watering can, a flower for King Pom. Open asks and the things you're fetching show on the map.
- **A guide.** A little pixel Chog waves from the corner. Tap it for how to get about, what's on the islands, every quest as it stands, and what your Chog's traits give it.
- **Testnet $CHOG.** Earned from stars, races, quests and a daily hello from your Chog, a little more for rarer traits. Spend it on a wish at the fountain or a song request for the singer. It lives in the game only and never touches a chain.
- **Your traits count everywhere.** Every Chog has 3 to 9 edges at the tables from its traits. Round the islands each main trait adds a perk too: eyes that sense nearby stars on the map, a quick start against Patrol, more $CHOG for quests, stars and the daily hello, a free wish with a lucky charm. The cast comment on your crown, your shades or your aura, and light up when you share a trait with them.
- **The Monad ticker.** An LED band round the Hub's dome that keeps changing: the Monad mark, gmonad, pixel Chogs hopping, Chogs from the collection.
- **Postcards.** Your Chog turns to the camera and waves, and the moment comes out as a vintage postcard with your Chog as the stamp, ready to share to X.
- **When a Chog leaves your wallet,** it goes grey, says goodbye and walks out of the world.
- **Music.** An island theme by day, a night theme after dark, and the singer's song you can hear from across the plaza.

No account, no gas: sign-in is a free signed message on Monad testnet. No wallet? Try a demo Chog or explore as a guest.

## Built with

three.js and Vite, plain JavaScript. Chog models made from the collection's art and rigged for the web; animation, faces and behaviour in code. Chat runs on Claude through a Vercel function. Wallets through Reown AppKit. Music made with Gemini, flights filmed with Seedance.

## Run it

```
npm install
npm run dev
```

Then open http://localhost:5173. Add `?q=low` on a slower machine.

For Chog chat, set `ANTHROPIC_API_KEY` (and optionally Upstash Redis for memory) as environment variables on the server. Keys never live in the repo.

## Credits

Models and assets are listed in [CREDITS.md](CREDITS.md).
