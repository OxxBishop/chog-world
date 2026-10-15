import * as THREE from 'three';
import { talk } from './brain.js';
import { CHOG_HEIGHT } from './chog.js';

/*
 * Talking with your Chog. A little panel to type to it; the Chog brain (brain.js) answers in its own
 * voice, from its traits and what it remembers of you. Each reply pops up over the Chog in a speech
 * bubble, and its mood plays out on the Chog itself: a move and a badge (chog.setMood).
 */

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const _p = new THREE.Vector3();

/**
 * Put a speech bubble over a point on screen, kept inside the screen's edges, with its tail still
 * pointing at the point.
 */
export function placeBubble(el, x, y) {
  const half = el.offsetWidth / 2;
  const cx = Math.min(Math.max(x, half + 8), window.innerWidth - half - 8);
  const tail = Math.max(-half + 18, Math.min(half - 18, x - cx));
  el.style.setProperty('--tail', `${tail}px`);
  el.style.transform = `translate(-50%, -100%) translate(${cx}px, ${y}px)`;
}

export function createChat({ camera, getSession, placeName }) {
  const panel = $('chat');
  const list = panel.querySelector('.chat-list');
  const form = panel.querySelector('form');
  const input = form.querySelector('input');
  const sendBtn = form.querySelector('button');
  const title = panel.querySelector('.chat-title');
  const bubble = $('chog-bubble');
  let waiting = false;
  let bubbleLeft = 0;

  const scrollDown = () => (list.scrollTop = list.scrollHeight);
  const add = (who, html) => {
    const li = document.createElement('li');
    li.className = `msg ${who}`;
    li.innerHTML = html;
    list.append(li);
    scrollDown();
    return li;
  };

  function open() {
    const s = getSession();
    if (!s?.chog) return;
    title.textContent = s.info.name;
    input.placeholder = `Say something to ${s.info.name}`;
    panel.hidden = false;
    requestAnimationFrame(() => panel.classList.add('on'));
    if (!list.children.length) add('note', esc(`${s.info.name} is listening. It remembers what you tell it.`));
    setTimeout(() => input.focus({ preventScroll: true }), 50);
  }

  function close() {
    panel.classList.remove('on');
    setTimeout(() => (panel.hidden = true), 220);
    input.blur();
  }

  function reset() {
    close();
    list.innerHTML = '';
    bubble.hidden = true;
    bubbleLeft = 0;
  }

  // The reply over the Chog's head, for a few seconds (longer for longer lines).
  function say(text) {
    bubble.textContent = text;
    bubble.hidden = false;
    bubbleLeft = Math.min(9, 2.5 + text.length / 22);
  }

  async function send(text) {
    const s = getSession();
    if (!s?.chog || waiting) return;
    waiting = true;
    sendBtn.disabled = true;
    add('you', esc(text));
    const typing = add('chog typing', '<span></span><span></span><span></span>');
    try {
      const session = s.demo ? { demo: true } : { address: s.address, message: s.message, signature: s.signature };
      const out = await talk({ id: s.id, session, text, place: placeName() });
      typing.remove();
      if (getSession() !== s) return;
      add('chog', esc(out.reply));
      if (out.newKeeper) add('note', esc(`${s.info.name} is getting to know you.`));
      if (out.learned?.length) add('note', esc(`${s.info.name} will remember that.`));
      s.chog.setMood(out.mood);
      s.chog.talk?.(Math.min(6, 1.2 + out.reply.length / 15));
      say(out.reply);
    } catch (err) {
      typing.remove();
      const msg = err?.status === 503 ? `${s.info.name} is resting. Chat opens soon.` : err?.message || 'Your Chog didn\'t answer. Try again.';
      add('note error', esc(msg));
    } finally {
      waiting = false;
      sendBtn.disabled = false;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim().slice(0, 400);
    if (!text) return;
    input.value = '';
    send(text);
  });
  panel.querySelector('.chat-close').addEventListener('click', close);
  // Keys typed here are for the Chog, not the camera.
  panel.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') close();
  });

  return {
    open,
    close,
    reset,
    send,
    // Its words over its head go, for a scene of its own (the sale, the goodbye).
    hush() {
      bubble.hidden = true;
      bubbleLeft = 0;
    },
    // Your Chog speaks first (its hello when you arrive): over its head, and in the chat.
    greet(text, mood) {
      const s = getSession();
      if (!s?.chog) return;
      add('chog', esc(text));
      if (mood) s.chog.setMood(mood);
      say(text);
    },
    get isOpen() {
      return !panel.hidden;
    },
    update(dt) {
      if (bubble.hidden) return;
      bubbleLeft -= dt;
      const s = getSession();
      const root = s?.chog?.root;
      if (bubbleLeft <= 0 || !root || !root.parent?.visible || !root.visible) {
        bubble.hidden = true;
        return;
      }
      // Follow the Chog's head on screen; hide when it's behind the camera.
      root.getWorldPosition(_p);
      _p.y += CHOG_HEIGHT + 0.95;
      _p.project(camera);
      if (_p.z > 1 || Math.abs(_p.x) > 1.2 || Math.abs(_p.y) > 1.2) {
        bubble.style.opacity = '0';
        return;
      }
      bubble.style.opacity = String(Math.min(1, bubbleLeft * 2));
      placeBubble(bubble, ((_p.x + 1) / 2) * window.innerWidth, ((1 - _p.y) / 2) * window.innerHeight);
    },
  };
}
