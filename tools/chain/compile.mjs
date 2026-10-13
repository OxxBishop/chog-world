// Compile ChogTestnet.sol with solc-js; writes build/ChogTestnet.json (abi + bytecode).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const solc = require('solc');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));

const input = {
  language: 'Solidity',
  sources: { 'ChogTestnet.sol': { content: fs.readFileSync(path.join(here, 'ChogTestnet.sol'), 'utf8') } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'cancun', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } },
};
function findImports(p) {
  const f = path.join(here, 'node_modules', p);
  return fs.existsSync(f) ? { contents: fs.readFileSync(f, 'utf8') } : { error: 'not found: ' + p };
}
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
const errors = (out.errors || []).filter((e) => e.severity === 'error');
for (const e of out.errors || []) console.log(e.severity, e.formattedMessage.split('\n')[0]);
if (errors.length) process.exit(1);
const c = out.contracts['ChogTestnet.sol'].ChogTestnet;
fs.mkdirSync(path.join(here, 'build'), { recursive: true });
fs.writeFileSync(path.join(here, 'build', 'ChogTestnet.json'), JSON.stringify({ abi: c.abi, bytecode: '0x' + c.evm.bytecode.object }, null, 1));
console.log('compiled: bytecode', c.evm.bytecode.object.length / 2, 'bytes; abi', c.abi.length, 'entries');
