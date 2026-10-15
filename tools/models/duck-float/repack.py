# Put a new image into a GLB in place of one of its images, keeping everything else byte for byte:
# the image's buffer view is resized and every later offset into the same buffer (including the
# EXT_meshopt_compression views) moves with it. Usage: python repack.py in.glb image_index new.jpg out.glb
import json
import struct
import sys

src, idx, img, dst = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4]
b = open(src, 'rb').read()
magic, ver, total = struct.unpack('<4sII', b[:12])
jl, jt = struct.unpack('<II', b[12:20])
j = json.loads(b[20:20 + jl])
o = 20 + jl
bl, bt = struct.unpack('<II', b[o:o + 8])
bin0 = bytearray(b[o + 8:o + 8 + bl])
new = open(img, 'rb').read()
bv = j['bufferViews'][j['images'][idx]['bufferView']]
assert bv.get('buffer', 0) == 0
start, old_len = bv.get('byteOffset', 0), bv['byteLength']
pad = lambda n: (n + 3) & ~3
delta = pad(len(new)) - pad(old_len)
# Every view (and meshopt source) in buffer 0 that starts after this image moves by delta.
for v in j['bufferViews']:
    if v is not bv and v.get('buffer', 0) == 0 and v.get('byteOffset', 0) > start:
        v['byteOffset'] += delta
    ext = v.get('extensions', {}).get('EXT_meshopt_compression')
    if ext and ext.get('buffer', 0) == 0 and ext.get('byteOffset', 0) > start:
        ext['byteOffset'] += delta
bv['byteLength'] = len(new)
body = bytes(bin0[:start]) + new + b'\0' * (pad(len(new)) - len(new)) + bytes(bin0[start + pad(old_len):])
j['buffers'][0]['byteLength'] = len(body)
js = json.dumps(j, separators=(',', ':')).encode()
js += b' ' * (pad(len(js)) - len(js))
body += b'\0' * (pad(len(body)) - len(body))
out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(body)) + struct.pack('<II', len(js), 0x4E4F534A) + js + struct.pack('<II', len(body), 0x004E4942) + body
open(dst, 'wb').write(out)
print('image', idx, old_len, '->', len(new), 'bytes; file', len(b), '->', len(out))
