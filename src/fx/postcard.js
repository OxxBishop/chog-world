/*
 * The postcard camera (B19): the view as it is, framed as a postcard with a Chog World stamp and your
 * Chog's name, saved as a PNG. The world is drawn once more and copied in the same moment, so the
 * canvas needs no preserved buffer.
 */
export function postcard({ frame, canvas, name = 'Chog World' }) {
  frame();
  const w = canvas.width, h = canvas.height;
  const pad = Math.round(Math.min(w, h) * 0.04), foot = Math.round(pad * 2.2);
  const out = document.createElement('canvas');
  out.width = w + pad * 2;
  out.height = h + pad + foot;
  const g = out.getContext('2d');
  g.fillStyle = '#fbf4e6';
  g.fillRect(0, 0, out.width, out.height);
  g.drawImage(canvas, pad, pad);
  g.strokeStyle = 'rgba(60, 40, 90, 0.25)';
  g.lineWidth = Math.max(1, pad * 0.06);
  g.strokeRect(pad, pad, w, h);
  // The caption: where, who, when.
  const fs = Math.round(foot * 0.36);
  g.fillStyle = '#3a2c63';
  g.font = `700 ${fs}px Fredoka, system-ui, sans-serif`;
  g.textBaseline = 'middle';
  g.fillText('Greetings from Chog World', pad, h + pad + foot / 2);
  g.font = `500 ${Math.round(fs * 0.7)}px system-ui, sans-serif`;
  g.textAlign = 'right';
  g.fillText(`${name} · ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}`, w + pad, h + pad + foot / 2);
  // The stamp, top right over the picture.
  const r = pad * 1.5, cx = w + pad - r * 1.4, cy = pad + r * 1.4;
  g.save();
  g.translate(cx, cy);
  g.rotate(-0.12);
  g.fillStyle = 'rgba(251, 244, 230, 0.92)';
  g.beginPath();
  g.arc(0, 0, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8a63ff';
  g.lineWidth = r * 0.08;
  g.setLineDash([r * 0.14, r * 0.1]);
  g.stroke();
  g.setLineDash([]);
  g.fillStyle = '#8a63ff';
  g.textAlign = 'center';
  g.font = `700 ${Math.round(r * 0.36)}px Fredoka, system-ui, sans-serif`;
  g.fillText('CHOG', 0, -r * 0.18);
  g.fillText('WORLD', 0, r * 0.24);
  g.restore();
  const a = document.createElement('a');
  a.download = `chog-world-${Date.now()}.png`;
  a.href = out.toDataURL('image/png');
  a.click();
}
