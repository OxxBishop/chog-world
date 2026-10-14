/*
 * Packs the clouds' big data files so the browser can unpack them cheaply (npm run pack-clouds).
 *
 * The sky's light tables (transmittance, irradiance and scattering through the air) ship with
 * @takram/three-atmosphere as EXR files, which the page then decoded in script on the main thread:
 * about a third of a second of frozen world, just as it first appears. Here they are decoded once
 * and stored the way EXR itself packs them (each value's low bytes, then its high bytes, each byte as
 * the change from the one before), gzipped. The browser inflates gzip natively and off the script's
 * time, and putting the bytes back is two quick loops (fetchPacked in src/volclouds.js). Same size as
 * the EXRs, same data. The clouds' shape noise is gzipped as it is.
 *
 *   public/assets/volclouds/{transmittance,irradiance,scattering}.zbin
 *   public/assets/volclouds/shape.zbin
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SKY = path.join(ROOT, 'node_modules/@takram/three-atmosphere/assets');
const CLOUDS = path.join(ROOT, 'node_modules/@takram/three-clouds/assets');
const OUT = path.join(ROOT, 'public/assets/volclouds');

const write = (name, bytes) => {
  const gz = zlib.gzipSync(bytes, { level: 9 });
  fs.writeFileSync(path.join(OUT, name), gz);
  console.log(`${name}: ${(bytes.length / 1024).toFixed(0)} KB, packed ${(gz.length / 1024).toFixed(0)} KB`);
};

for (const name of ['transmittance', 'irradiance', 'scattering']) {
  const file = fs.readFileSync(path.join(SKY, `${name}.exr`));
  const exr = new EXRLoader().parse(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength));
  const bytes = new Uint8Array(exr.data.buffer, exr.data.byteOffset, exr.data.byteLength);
  const n = bytes.length / 2;
  const planes = new Uint8Array(bytes.length);
  for (let i = 0; i < n; i++) {
    planes[i] = bytes[2 * i];
    planes[n + i] = bytes[2 * i + 1];
  }
  for (let i = planes.length - 1; i > 0; i--) planes[i] = (planes[i] - planes[i - 1]) & 255;
  write(`${name}.zbin`, planes);
}
write('shape.zbin', fs.readFileSync(path.join(CLOUDS, 'shape.bin')));
