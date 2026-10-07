# Chog World: Chogathon 2026 concept

Solo entry by oxxbishop. Registered 2026-10-07. The entry can be edited until the build starts.

## The hackathon

| | |
|---|---|
| Event | Chogathon 2026 (chogathon.chog.xyz), online |
| Registration closes | 2026-10-08 15:00 UTC (taken from the site's countdown code) |
| Build | 14 days, about Oct 8 15:00 UTC to Oct 22 15:00 UTC |
| Judging | 7 days after the build |
| Prize pool | $15K (may drop to $10K on low quality), 50 winners, 1st place $4,500 |
| Scoring | Novelty 30, Fun 20, Retention 20, Clarity 15, Execution 15, plus an optional $CHOG bonus |
| Hard rule | The Chog NFT must be essential |
| Deliverables | Demo or video (3 min max), repo, tech stack, project details, future vision |

Holding a Chog or $CHOG is not required to enter. The build overlaps Open Agent's build window (Oct 15 to 20).

## The idea

A living world for Chogs. Connect a wallet that holds a Chog and it comes alive on a shared 3D island.

- **The traits become its personality.** How it talks, what it's good at and how it moves all come from its traits.
- **It lives in the world.** It explores, interacts with the island and meets other Chogs on its own.
- **It learns you.** Every conversation teaches it more about its owner, and it picks up your mannerisms until it's a mini version of you, your "Chog buddy".
- **It has a life while you're away.** It keeps living, and tells you what you missed when you come back.

### When the NFT leaves

- The Chog becomes a **grey NPC**: it wanders the island on autopilot with no personality. Lights on, nobody home. Other players see it too.
- The previous owner gets **warped out** of the Chog World. Their access is revoked until they hold another Chog, so the NFT also works as the access key.
- **The new owner gets the same Chog, but never the same buddy.** It keeps its trait personality and its life in the world (places it's been, Chogs it knows). Everything it learned from the previous owner, their mannerisms and conversations, is wiped. That also solves privacy.

### The disconnect cutscene (the centrepiece of the demo)

The owner is the camera. There is no player avatar.

1. The hub, in third person behind the Chog.
2. The Chog stops and turns to look at the camera, one last goodbye.
3. The colour drains from its feet up. It goes grey, turns, and walks off into the island as an NPC. The hub is empty.
4. The camera is yanked up and back. The island shrinks into a little diorama in the void, and you can still pick out the grey Chog wandering among the living ones.
5. The island becomes a dot, then fades to black.
6. "Your Chog has moved on." ... "Hold a Chog to return."

**Trigger:** a Transfer event while the owner is online plays it straight away. Otherwise it plays at their next login, opening with "While you were away...".

## Registration text (as submitted)

**Pitch:** A living world where your Chog comes alive, learns from you, and becomes your little buddy in the Chog world.

**Why the Chog NFT matters:** The NFT is the Chog. The moment you connect, it comes alive in the Chog world. Its traits become its personality, it explores and interacts with the world, and every conversation teaches it more about you, until it's a mini version of you. Sell the NFT and you lose your Chog buddy. It turns to look at you one last time, goes grey and wanders off as a lifeless NPC, and you get warped out of the Chog world until you hold another Chog. The new owner gets the same Chog, but never the same buddy, because it starts learning them from scratch.

## Why it should score

- **Novelty (30):** "chat with your NFT" will show up several times, but a shared world where Chogs live, meet each other, learn their owners and die when sold should be rare. Rough guess: about 5% of entries for the full combination.
- **Fun and retention (40):** "what did my Chog do today?" and a buddy that grows more like you give people a reason to come back daily.
- **The NFT rule:** the token is the life, the memory and the key. No NFT, no Chog, no way in.
- **Execution:** real 3D, not a chat window.

Lead the demo with the life, not the chat. A small island with great Chogs wins; a big world with dumb Chogs doesn't.

## The collection

| | |
|---|---|
| Collection | Chog Genesis (opensea.io/collection/chog-genesis) |
| Contract | `0xc96d31f8626c6d03fae5dcd3d61e3fb9f4a73763` (ERC-721) |
| Chain | Monad |
| Supply / owners | 1,969 / about 1,012 |
| Floor | about 4,800 MON (2026-10-07) |
| Metadata | IPFS JSON per token |

### Traits and how each renders

| Trait | Values | Plan |
|---|---|---|
| Skin | 14 | Material colour on the base body |
| Aura | 22 | Particle effects (smoke, electric, mist, fire) |
| Background | 32 | Colour of the owner's hub or plot |
| Eyes | 58 | 2D face textures, swapped by mood |
| Mouth | 15 | 2D face textures |
| Accessory | 9 | Small held props |
| Base / Form | 4 / 2 | Origin; Skull (own head model); Radioactive (glowing translucent shader); 1:1 (custom fallback) |
| Head | 66 | Grouped into about 10 mesh shapes (cap, beanie, horns, bandana, hat, helmet...), recoloured or textured per trait |
| Body | 96 | Grouped into about 6 outfit shapes (jersey, hoodie, suit, shirt, jacket, naked), with the design as a texture |

The AI personality reads every trait exactly. That's where each Chog is truly unique, and it costs nothing.

### Art style, from the official art

- The art is **head portraits only**. A Chog's full body has never been drawn, so we define it: a **chibi** body, with a big head on a small round body.
- Thick black outlines, flat colours, blush cheeks, grainy paper texture. This needs **toon (cel) shading with outlines** in Three.js. Realistic lighting would make them look like plastic toys.
- **The eyes carry the personality**, so faces are 2D textures on the 3D head.
- **Silhouette:** a round head with spiky tufts behind it. The base model has to get this right.
- Variants: Skull (purple skull head with teeth), Radioactive (green translucent glow with the skull showing), 1:1s (fully custom; fall back to a portrait card, or hand-pick a few).

## How it's built

### Ownership and access

```
connect wallet -> sign a message (SIWE, no gas) -> server verifies
  -> list Chogs in the wallet (NFT API) -> pick one -> ownerOf(tokenId) check on Monad
  -> Chog wakes (memories loaded by contract + tokenId)
  -> Transfer event on the contract -> Chog greys out, owner warped out
```

- Memory is stored per token (`contract + tokenId`) in a simple database such as Supabase or SQLite. Nothing goes on-chain.
- A Chog is **alive** when its current owner has signed in recently and `ownerOf` still matches. Otherwise it's **grey**.
- Listing on a marketplace does not transfer the token, so a listed Chog stays alive.
- Cold or vault wallets could be supported later through delegate.xyz. That's out of scope for the hackathon.
- **Memory split:** world memories (places, friends, adventures) stay with the token; owner memories (mannerisms, chats) are wiped on transfer. It can still remember "my old friend 0x7e3...".

### World and rendering

- Three.js + Vite, new code. **Bot Crossing** (Station-Sciences, MIT) is the reference for the look. It is not forked. Its name and its post-Sep-16 character designs are reserved, so credit it as inspiration.
- CC0 assets from KayKit (Kay Lousberg) and Kenney for the island and props.
- Cameras: a **diorama overview** of the whole island, plus a **third-person follow** that glides in when you click your Chog. No first person, no VR.
- Animation in code instead of rigging: squash and stretch, bounce, lean into turns, blink, a talking wobble.
- Toon shading with outlines to match the 2D art.

### 3D assets: solo, using AI

- **GPT-6 Astra** (it drives Blender, and turns images into 3D models), with Meshy or Tripo as a fallback. Clean up in Blender.
- The prompt for the base model:
  > "Chibi 3D character from this 2D art: large round head with spiky tufts at the back, small round body with stubby arms and legs, toon / cel-shaded style, flat colours, no facial features modelled (face will be a texture), low-poly game-ready glTF, single material, origin at the feet, Y-up, under 5k triangles."
- Repeat for the skull-head variant. Trait pieces are separate small glTFs, each lined up to an attachment point (head, hand, back).

### AI personality

- A small, fast model with short, cached conversations to control cost and latency.
- A system prompt built from the traits, plus memory summaries per token (world) and per owner (personal).
- Chog-to-Chog conversations run on a timer, with no human involved. That's the clip to lead the demo with.

## 14-day plan

| Days | Build |
|---|---|
| 1 | Base Chog in Astra. Test it on day 1: if the model is right, everything else is execution |
| 1-3 | Island scene, Chogs loaded by token, traits mapped to personality, toon shading |
| 4-7 | Chat with memory per token, Chog-to-Chog conversations, autopilot wandering |
| 8-10 | Ownership (SIWE, ownerOf, Transfer listener), grey NPC state, the disconnect cutscene |
| 11-12 | Daily recap (web, optionally Telegram), hosting, polish |
| 13-14 | Demo video, buffer |

## Demo video (3 min)

1. Open on the island diorama, full of living Chogs (about 10 s).
2. Click your Chog, and the camera glides into third person.
3. Two holders' Chogs meet and talk about their owners.
4. Your Chog shows something it picked up from you.
5. The sale: the disconnect cutscene, end to end.
6. The new owner connects: the same Chog wakes up, remembers the island, but doesn't know them yet.

## Open items

- A real Chog for the demo. Either deploy a mock with the same metadata on Monad testnet for the transfer, or borrow a holder's wallet for the recording. Real Chogs can always be viewed read-only.
- Full-resolution reference art: an Origin skin with no head item and normal eyes, for the base model.
- The rough look for the island (a sketch or screenshots).
- About 1,000 holders, some of them probably judges: every token's face and skin colour has to be right.
