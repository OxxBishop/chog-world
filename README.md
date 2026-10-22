# Chog World

A cosy 3D world in the browser where your Chog NFT comes to life. Sign in with your wallet and your Chog wakes up in its own glass dome, waves hello, and walks the islands with you. Talk to it and it remembers you.

**Live:** https://chog-world.vercel.app · Chogathon 2026 entry · Monad testnet

## What's in it

- **Your Chog, alive.** Every Chog in your wallet is a rigged 3D model with its own face, idle, walk, run and little moods. It wakes up when you sign in, follows you into rooms, and says goodbye when you sign out.
- **It talks back.** Chat with your Chog from anywhere. It has a personality from its traits and keeps a memory of what you tell it.
- **A world to wander.** Floating islands over a sea of clouds: the plaza with a fountain and a singer on stage, Chog Hub, three neighbourhoods of domes, glass bridges, portals between islands, hoverboards, birds, manta rays and a whale in the sky. Real time of day, with an aurora at night.
- **A cast of Chogs.** Snooze naps under the giant tree, Patrol rides his hover chopper, King Pom holds court. Chogs chat at the bar and greet you as you pass.
- **Chog Hub.** A lobby, a bar, and the Starlite Lounge casino with Chog Slots and roulette on free testnet chips. Every Chog trait gives you an edge at the tables.
- **The Monad ticker.** An LED band round the Hub's dome that keeps changing: the Monad mark, gmonad, pixel Chogs hopping, Chogs from the collection.
- **Postcards.** Frame any moment as a postcard with your Chog as the stamp, and share it to X.
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
