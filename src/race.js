import { playerStore } from './playerstore.js';
import * as THREE from 'three';
import { HOODS } from './layout.js';
import { surfaceAt } from './travel.js';

/*
 * Race Patrol (the user's pick, 10-23): you on a hoverboard against Patrol on his hover chopper, one lap
 * of the first neighbourhood's loop road. A start arch stands where the bridge's road meets the loop; ride
 * into it on a board and a card offers the race. Under a quick dip you line up beside him, 3, 2, 1, and
 * away: five gates rise round the loop (the next one glows gold), a timer and your place at the top. He
 * paces himself to you, so it's close, and only a flat-out run beats him at the line. Over the line:
 * a flash, the result, and his salute; then he rides on with his patrol.
 *
 * createRace({ scene, camera, travel, npcs, dip, onWin, perks }) -> { update(dt, env), active }
 * perks() is your Chog's island perks (src/islandperks.js): a Head trait has Patrol wait a moment at Go.
 * npcs() is src/npcs.js (patrol() gives his rider, src/rider.js); dip(fn) runs fn under a fade;
 * onWin({ time, gap }) after you beat him (the testnet $CHOG reward, src/purse.js).
 */

const HOOD = HOODS[0];
const R = HOOD.loopR;
// Where the bridge's road meets the loop: the start and finish. The race goes the way his patrol does.
const A0 = HOOD.angle + Math.PI;
const GATES = 6;
// How far from the road's middle counts as through a gate's arch (its half span, and a little).
const GATE_IN = 3.9;
const at = (a, r = R) => new THREE.Vector3(HOOD.x + Math.cos(a) * r, 0, HOOD.z + Math.sin(a) * r);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const KEY = 'chogworld.race.v1';
const sfx = (name) => dispatchEvent(new CustomEvent('chog-sfx', { detail: name }));

// The arch over the road: a half ring of light, a soft glow round it, a turning diamond on top.
const COL = { idle: new THREE.Color('#b48cff'), next: new THREE.Color('#ffd27a'), done: new THREE.Color('#fff6e0') };
function arch(start) {
  const g = new THREE.Group();
  const span = 3.3;
  const mat = new THREE.MeshStandardMaterial({ color: '#fff8ea', emissive: COL.idle.clone(), emissiveIntensity: 1.6, roughness: 0.35, metalness: 0.2 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(span, 0.11, 10, 64, Math.PI), mat);
  const glowMat = new THREE.MeshBasicMaterial({ color: COL.idle.clone(), transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false });
  const glow = new THREE.Mesh(new THREE.TorusGeometry(span, 0.42, 8, 48, Math.PI), glowMat);
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.34), mat);
  gem.position.y = span + 0.6;
  gem.scale.y = 1.5;
  // Its feet: two small gold plinths on the verges.
  const footMat = new THREE.MeshStandardMaterial({ color: '#d9c08a', roughness: 0.4, metalness: 0.6 });
  for (const x of [-span, span]) {
    const f = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.4, 0.3, 16), footMat);
    f.position.set(x, 0.15, 0);
    g.add(f);
  }
  g.add(ring, glow, gem);
  if (start) {
    const c = document.createElement('canvas');
    c.width = 1024;
    c.height = 256;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const draw = () => {
      const x = c.getContext('2d');
      x.clearRect(0, 0, 1024, 256);
      x.fillStyle = 'rgba(20, 14, 40, 0.86)';
      x.beginPath();
      x.roundRect(8, 8, 1008, 240, 40);
      x.fill();
      x.strokeStyle = 'rgba(236, 220, 174, 0.75)';
      x.lineWidth = 5;
      x.stroke();
      x.textAlign = 'center';
      x.fillStyle = '#ecdcae';
      x.font = '600 108px Cinzel, serif';
      x.fillText('RACE PATROL', 512, 140);
      x.fillStyle = 'rgba(255, 255, 255, 0.82)';
      x.font = '600 38px "Josefin Sans", sans-serif';
      x.fillText('O N E   L A P   ·   H O V E R B O A R D S', 512, 210);
      tex.needsUpdate = true;
    };
    draw();
    document.fonts?.load('600 108px Cinzel').then(draw, () => {});
    document.fonts?.load('600 38px "Josefin Sans"').then(draw, () => {});
    // Back to back, so it reads the right way round from either side.
    const signMat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false });
    for (const turn of [0, Math.PI]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.9), signMat);
      sign.position.y = span - 0.75;
      sign.rotation.y = turn;
      g.add(sign);
    }
  }
  return { group: g, mat, glowMat, gem, set(kind) {
    mat.emissive.copy(COL[kind]);
    glowMat.color.copy(COL[kind]);
    glowMat.opacity = kind === 'next' ? 0.4 : kind === 'done' ? 0.12 : 0.22;
    mat.emissiveIntensity = kind === 'next' ? 2.4 : kind === 'done' ? 0.9 : 1.6;
  } };
}

export function createRace({ scene, camera, travel, npcs, dip, onWin = null, perks }) {
  // The gates: 0 is the start and finish (always there); the rest rise for a race.
  const gates = [];
  for (let i = 0; i < GATES; i++) {
    const a = A0 + (Math.PI * 2 * i) / GATES;
    const p = at(a);
    const gt = arch(i === 0);
    gt.group.position.set(p.x, surfaceAt(p.x, p.z), p.z);
    // Its ring across the road (local x along the radius), facing along it.
    gt.group.rotation.y = -a;
    gt.group.visible = i === 0;
    gt.a = a;
    gt.rise = i === 0 ? 1 : 0;
    scene.add(gt.group);
    gates.push(gt);
  }
  // Patrol's line: the outside of the road (the boards wait on its inside, by the domes' drives).
  const track = new THREE.CatmullRomCurve3(
    Array.from({ length: 96 }, (_, i) => at(A0 + (Math.PI * 2 * i) / 96, R + 1.8)),
    true,
    'centripetal',
  );

  // ---------- the interface ----------
  const el = document.createElement('div');
  el.className = 'pl-race-ui';
  el.innerHTML = `
    <div class="pl-card pl-offer" hidden><b class="pl-title">Race Patrol</b><p class="pl-text"></p><div class="pl-acts"><button type="button" class="pl-btn pl-go">Race</button></div></div>
    <div class="pl-count" hidden></div>
    <div class="pl-hud" hidden></div>
    <div class="pl-card pl-result" hidden><b class="pl-title"></b><p class="pl-text"></p><div class="pl-acts"><button type="button" class="pl-btn pl-again">Again</button><button type="button" class="pl-btn pl-done">Done</button></div></div>
    <div class="pl-flash"></div>
    <div class="chog-bubble bar-bubble pl-say" hidden><span class="who">Patrol</span><span class="line"></span></div>`;
  document.body.append(el);
  const q = (s) => el.querySelector(s);
  const ui = { offer: q('.pl-offer'), offerText: q('.pl-offer .pl-text'), go: q('.pl-go'), count: q('.pl-count'), hud: q('.pl-hud'), result: q('.pl-result'), resTitle: q('.pl-result .pl-title'), resText: q('.pl-result .pl-text'), say: q('.pl-say'), sayLine: q('.pl-say .line'), flash: q('.pl-flash') };
  // Taps on the cards are for the cards (never a drag of the view behind them).
  for (const c of el.querySelectorAll('.pl-card')) c.addEventListener('pointerdown', (e) => e.stopPropagation());
  ui.go.addEventListener('click', () => begin());
  q('.pl-again').addEventListener('click', () => begin());
  q('.pl-done').addEventListener('click', () => {
    ui.result.hidden = true;
    rest = 1.5;
  });

  let mode = 'idle';
  let rider = null;
  let t = 0, count = 0, prog = 0, lastA = 0, passed = 0, offBoard = 0, rest = 0, outro = 0;
  let pLaps = -1, pLast = 0, pTime = null, myTime = null;
  // How he rides this race (begin sets it).
  let style = { chase: 0.42, endAt: 0.74, endEase: 0.93, bursts: [] };
  // This player's best time and wins (src/playerstore.js).
  const store = playerStore(KEY);
  const me = new THREE.Vector3(), head = new THREE.Vector3();
  const st = () => travel.state;

  const show = (node, on) => node.hidden !== !on && (node.hidden = !on);
  function offer(onBoard) {
    const best = store.get();
    const b = best.best ? ` Your best: ${fmt(best.best)}.` : '';
    ui.offerText.textContent = onBoard ? `One lap of the loop, through the gates.${b}` : `Hop on a hoverboard to race him. One waits by every dome.${b}`;
    show(ui.go.parentNode, onBoard);
    show(ui.offer, true);
  }

  async function begin() {
    if (mode === 'count' || mode === 'race' || mode === 'starting') return;
    if (st().board < 0 || !travel.active) return;
    mode = 'starting';
    show(ui.offer, false);
    show(ui.result, false);
    rider = await npcs()?.patrol?.();
    if (!rider || st().board < 0 || !travel.active) {
      mode = 'idle';
      return;
    }
    await dip(() => {
      // You on the inside of the line, him on the loop's middle, side by side a little behind it.
      const a = A0 - 2.2 / R;
      const p = at(a, R - 1.1);
      const s = st();
      s.pos.set(p.x, surfaceAt(p.x, p.z), p.z);
      s.vel.set(0, 0, 0);
      s.yaw = Math.atan2(-Math.sin(a), Math.cos(a));
      s.camYaw = s.yaw + Math.PI;
      s.lastLook = 0;
      s.busy = 'race';
      rider.race(track, track.getLength() - 2.2, 0);
      // Each race his own (the user, 10-23: his line and pace learned, he was easy to beat): a line that
      // weaves across the road its own way, a couple of sprints, and how hard he chases and eases off. A
      // flat-out run still edges him at the line.
      const rnd = Math.random;
      const w = { off: (rnd() * 2 - 1) * 1.1, a: 0.6 + rnd() * 1.5, f: 1 + Math.floor(rnd() * 3), ph: rnd() * Math.PI * 2 };
      rider.line = (u) => THREE.MathUtils.clamp(w.off + Math.sin(u * Math.PI * 2 * w.f + w.ph) * w.a, -3.2, 2.4);
      style = {
        chase: 0.34 + rnd() * 0.16,
        endAt: 0.68 + rnd() * 0.1,
        endEase: 0.9 + rnd() * 0.05,
        bursts: [0, 1].map((i) => ({ at: 0.12 + i * 0.32 + rnd() * 0.2, len: 0.06 + rnd() * 0.05, add: 1 + rnd() * 1.3 })),
      };
      rider.salute = 0;
      for (const g of gates) {
        g.group.visible = true;
        g.set('idle');
      }
      gates[1].set('next');
    });
    mode = 'count';
    count = 3.4;
    t = 0;
    // (From your spot, a little behind the line: the lap counts from the line.)
    prog = -2.2 / R / (Math.PI * 2);
    passed = 0;
    offBoard = 0;
    pLaps = -1;
    pLast = rider.along;
    pTime = myTime = null;
    lastA = Math.atan2(st().pos.z - HOOD.z, st().pos.x - HOOD.x);
    show(ui.count, true);
    ui.count.textContent = '';
  }

  function end(quiet = false) {
    mode = quiet ? 'idle' : 'done';
    if (st().busy === 'race') st().busy = null;
    show(ui.count, false);
    show(ui.hud, false);
    for (let i = 1; i < GATES; i++) gates[i].group.visible = false;
    gates[0].set('idle');
    if (quiet) {
      if (rider) {
        rider.unrace();
        rider.fade = 1;
      }
      rest = 2;
    }
  }

  function finish() {
    myTime = t;
    const won = pTime === null;
    const gap = won ? null : myTime - pTime;
    sfx('finish');
    ui.flash.classList.remove('on');
    void ui.flash.offsetWidth;
    ui.flash.classList.add('on');
    const best = store.get();
    const isBest = !best.best || myTime < best.best;
    if (isBest) best.best = +myTime.toFixed(2);
    if (won) best.wins = (best.wins ?? 0) + 1;
    store.save();
    ui.resTitle.textContent = won ? 'You beat Patrol' : 'Patrol wins';
    ui.resText.textContent = won
      ? `${fmt(myTime)}${isBest ? ', your best yet' : `, best ${fmt(best.best)}`}.`
      : `${gap < 0.15 ? 'By a nose' : `By ${gap.toFixed(1)} s`}. You: ${fmt(myTime)}${isBest ? ', your best yet' : ''}.`;
    end();
    show(ui.result, true);
    outro = 0;
    stopped = false;
    sayLine = won ? (Math.random() < 0.5 ? 'Well ridden. Rules are rules: you won.' : 'Fair and square. Nicely done.') : Math.random() < 0.5 ? 'Close one. Same time tomorrow?' : 'Good race. Keep your eyes on the gates.';
    if (won) onWin?.({ time: myTime });
  }
  let sayLine = '';
  let lastHud = '';
  let stopped = false;

  // Him and his chopper fading when the camera is right on him (side by side, he can pass close by it).
  const mid = new THREE.Vector3();
  function lensFade() {
    if (!rider) return;
    rider.group.getWorldPosition(mid);
    mid.y += 1.6;
    rider.fade = THREE.MathUtils.smoothstep(mid.distanceTo(camera.position), 2.6, 5.2);
  }

  // His bubble, over his head while he says his line.
  function placeSay(on) {
    if (!on || !rider) return show(ui.say, false);
    rider.group.getWorldPosition(head);
    head.y += 4.3;
    head.project(camera);
    if (head.z > 1 || Math.abs(head.x) > 1.1 || Math.abs(head.y) > 1.1) return show(ui.say, false);
    if (ui.sayLine.textContent !== sayLine) ui.sayLine.textContent = sayLine;
    show(ui.say, true);
    const w = ui.say.offsetWidth, h = ui.say.offsetHeight;
    const sx = ((head.x + 1) / 2) * innerWidth, sy = ((1 - head.y) / 2) * innerHeight;
    const x = THREE.MathUtils.clamp(sx - w / 2, 10, innerWidth - w - 10);
    ui.say.style.transform = `translate(${x}px, ${Math.max(10, sy - h - 12)}px)`;
    ui.say.style.setProperty('--tail', `${THREE.MathUtils.clamp(sx - (x + w / 2), -w / 2 + 18, w / 2 - 18)}px`);
  }

  return {
    get active() {
      return mode === 'count' || mode === 'race';
    },
    // For the trailer (src/shots.js): his line round the loop, and every gate up, the next one gold.
    get track() {
      return track;
    },
    showcase(on, next = 1) {
      for (let i = 0; i < GATES; i++) {
        gates[i].group.visible = on || i === 0;
        gates[i].set(on && i === next % GATES ? 'next' : 'idle');
      }
    },
    update(dt) {
      // The gates rising for a race, their diamonds turning.
      for (const g of gates) {
        g.gem.rotation.y += dt * 1.4;
        if (g.group.visible) {
          g.rise = Math.min(1, g.rise + dt * 2.2);
          const k = g.rise * g.rise * (3 - 2 * g.rise);
          g.group.scale.set(1, Math.max(0.001, k), 1);
        } else g.rise = 0;
      }
      const s = st();
      const out = travel.active && s.chog;
      if (mode === 'idle' || mode === 'done') {
        rest = Math.max(0, rest - dt);
        if (out) me.copy(s.pos);
        const near = out && !s.busy && rest <= 0 && ui.result.hidden && Math.hypot(me.x - gates[0].group.position.x, me.z - gates[0].group.position.z) < 4.6;
        if (near) offer(s.board >= 0);
        else show(ui.offer, false);
        // Him after the line: pulling up beside you (a few metres on, where you can see him), the salute and
        // his line, and off on patrol again.
        if (mode === 'done' && rider) {
          outro += dt;
          lensFade();
          if (!stopped) {
            // Riding to a spot a little ahead of you, and keeping to it while you roll to a stop.
            const L = rider.length;
            const mine = ((Math.atan2(s.pos.z - HOOD.z, s.pos.x - HOOD.x) - A0) / (Math.PI * 2) + 2) % 1;
            let ahead = ((mine * L + 8 - rider.along) % L + L) % L;
            if (ahead > L * 0.6) ahead -= L;
            const myV = Math.hypot(s.vel.x, s.vel.z);
            const vt = THREE.MathUtils.clamp(myV + ahead * 0.8, 0, 11);
            rider.speed = Math.max(0, rider.speed + THREE.MathUtils.clamp(vt - rider.speed, -7 * dt, 5 * dt));
            if ((rider.speed < 0.25 && myV < 0.6 && Math.abs(ahead) < 3) || outro > 8) {
              stopped = true;
              rider.speed = 0;
              outro = 0;
            }
          } else if (outro < 3.2) {
            rider.salute = Math.min(1, outro / 0.5) * (1 - THREE.MathUtils.smoothstep(outro, 2.6, 3.2));
          } else if (outro < 4.8) rider.speed = Math.min(7.5, rider.speed + dt * 5);
          else {
            rider.unrace();
            rider.fade = 1;
            mode = 'idle';
          }
          placeSay(stopped && outro > 0.15 && outro < 4.2);
        } else placeSay(false);
        return;
      }
      if (mode === 'starting') return;
      lensFade();
      // Called off: off your board a moment, away from the loop, or out of the world (a room, a portal).
      const r = Math.hypot(s.pos.x - HOOD.x, s.pos.z - HOOD.z);
      offBoard = s.board < 0 ? offBoard + dt : 0;
      if (!out || offBoard > 1.2 || Math.abs(r - R) > 16 || (s.busy && s.busy !== 'race')) return end(true);
      if (mode === 'count') {
        const before = Math.ceil(count);
        count -= dt;
        const n = Math.ceil(count);
        if (n !== before && n >= 1 && n <= 3) {
          ui.count.textContent = String(n);
          ui.count.classList.remove('pop');
          void ui.count.offsetWidth;
          ui.count.classList.add('pop');
          sfx('beep');
        }
        if (count <= 0) {
          mode = 'race';
          s.busy = null;
          ui.count.textContent = 'Go';
          ui.count.classList.remove('pop');
          void ui.count.offsetWidth;
          ui.count.classList.add('pop', 'go');
          sfx('go');
          setTimeout(() => {
            show(ui.count, false);
            ui.count.classList.remove('go');
          }, 900);
          show(ui.hud, true);
        }
        return;
      }
      // Racing.
      t += dt;
      const a = Math.atan2(s.pos.z - HOOD.z, s.pos.x - HOOD.x);
      prog += wrap(a - lastA) / (Math.PI * 2);
      lastA = a;
      const L = rider.length;
      if (rider.along < pLast - L / 2) pLaps++;
      pLast = rider.along;
      const theirs = (pLaps * L + rider.along) / L;
      if (pTime === null && theirs >= 1) pTime = t;
      // The next gate, ridden through: within its arch, at its line (the user, 10-23: cutting across the
      // middle and back onto the road ticked off every gate missed). Miss one and it waits, gold: back
      // through it, then on.
      const ng = gates[passed + 1];
      if (passed < GATES - 1 && ng && Math.abs(r - R) < GATE_IN && Math.abs(wrap(a - ng.a) * R) < 2.5) {
        passed++;
        gates[passed].set('done');
        if (passed < GATES - 1) gates[passed + 1].set('next');
        else gates[0].set('next');
        sfx('gate');
      }
      // His pace: yours (in his lane, the longer one outside), a little more when you're ahead and less when
      // you're behind, nosing just ahead, so it's neck and neck; in the last stretch he eases a touch, so
      // a flat-out run edges past him at the line and anything less doesn't.
      const yours = Math.hypot(s.vel.x, s.vel.z);
      const lane = (R + 1.8) / Math.max(18, r);
      const gap = (prog - theirs) * L;
      // (This race's own ways, from begin: how hard he chases, when and how much he eases off at the end,
      // and his sprints.)
      let want = THREE.MathUtils.clamp(Math.max(yours, 6.5) * lane + gap * style.chase + 0.35, 6.2, 12.8);
      for (const b of style.bursts) if (theirs > b.at && theirs < b.at + b.len) want += b.add * Math.sin(Math.PI * (theirs - b.at) / b.len);
      if (theirs > style.endAt && pTime === null) want = Math.min(want, Math.max(yours * lane * style.endEase, 6.2));
      if (pTime !== null) want = 7.5;
      // Quick start (a Head trait): he waits a moment at Go.
      if (t < (perks?.()?.head ?? 0)) want = 0;
      // (A quick getaway off the line: your board is quick off the mark.)
      rider.speed = rider.speed + THREE.MathUtils.clamp(want - rider.speed, -dt * 4, dt * (t < 2 ? 11 : 6));
      const place = pTime !== null ? 2 : prog >= theirs ? 1 : 2;
      const missed = prog > (passed + 1) / GATES + 0.04;
      const goal = passed >= GATES - 1 ? '<b>Finish</b>' : missed ? `<b>Back to gate ${passed + 1}</b>` : `<b>Gate ${passed + 1}</b> of ${GATES - 1}`;
      const html = `<span>${goal}</span><span class="pl-time">${fmt(t)}</span><span><b>${place === 1 ? '1st' : '2nd'}</b></span>`;
      if (html !== lastHud) ui.hud.innerHTML = lastHud = html;
      // (Over the line itself, under its arch: an extra lap round to the last gates doesn't end it there.)
      if (passed >= GATES - 1 && prog >= 1 && Math.abs(r - R) < GATE_IN && Math.abs(wrap(a - A0) * R) < 3) finish();
    },
  };
}
