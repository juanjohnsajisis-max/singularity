import fs from 'fs';
const html = fs.readFileSync('LNP Forge.html', 'utf8');
const line = html.split('\n').find(l => l.startsWith('const LIB='));
const start = line.indexOf('{');
const end = line.indexOf('},LKS=');
if (start < 0 || end < 0) { console.error('not found'); process.exit(1); }
const obj = line.slice(start, end + 1);
const ts = fs.readFileSync('src/lib/data.ts', 'utf8').replace(
  /export const USH_DEMO/,
  `export const LIB = ${obj};\n\nexport const USH_DEMO`
);
fs.writeFileSync('src/lib/data.ts', ts);
console.log('LIB bytes:', obj.length);
