import fs from 'fs';
const html = fs.readFileSync('LNP Forge.html', 'utf8');
const lines = html.split('\n');
const out = {};
for (const ln of lines) {
  const m = ln.match(/^const (D|ML|LI|LIB)=(\{.*\})\s*;?\s*$/);
  if (m) out[m[1]] = m[2];
}
// USH demo string
const ush = html.match(/const USH=`([\s\S]*?)`;/);
if (ush) out.USH = ush[1];
fs.mkdirSync('src/lib', { recursive: true });
const names = Object.keys(out);
let ts = `// Auto-extracted from the original single-file app. Do not edit by hand.\n`;
ts += `export const D = ${out.D};\n\n`;
ts += `export const ML = ${out.ML};\n\n`;
ts += `export const LI = ${out.LI};\n\n`;
ts += `export const LIB = ${out.LIB};\n\n`;
ts += `export const USH_DEMO = ${JSON.stringify(out.USH)};\n`;
fs.writeFileSync('src/lib/data.ts', ts);
console.log('extracted:', names, 'data.ts bytes:', ts.length);
