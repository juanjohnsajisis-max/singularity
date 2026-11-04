// Minimal SMILES parser + hashed ECFP fingerprint — ported verbatim.

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export const crc32 = (s: string): number => {
  let c = 0xffffffff;
  for (let i = 0; i < s.length; i++)
    c = CRC[(c ^ s.charCodeAt(i)) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

const ORG = [
  "Cl", "Br", "B", "C", "N", "O", "P", "S", "F", "I",
  "b", "c", "n", "o", "p", "s",
];

export function smiParse(s: string): [any[], any[][]] {
  const at: any[] = [],
    adj: any[][] = [],
    stack: any[] = [],
    rings: Record<number, any> = {};
  let prev: number | null = null,
    pend: number | null = null,
    i = 0;

  const add = (el: string, ar: boolean, ch: number) => {
    at.push([el, ar, ch]);
    adj.push([]);
    return at.length - 1;
  };
  const bond = (a: number, b: number, o: number) => {
    adj[a].push([b, o]);
    adj[b].push([a, o]);
  };

  while (i < s.length) {
    const c = s[i];
    let a: number;
    if (c === "[") {
      const j = s.indexOf("]", i),
        t = s.slice(i + 1, j);
      i = j + 1;
      const m = t.match(
        /^(\d*)([A-Z][a-z]?|[a-z]{1,2})(@{0,2})(H\d*)?([+-]+\d*|\+\+|-+)?(:\d+)?$/
      );
      if (!m) throw new Error("bad atom " + t);
      const el = m[2];
      let ch = 0;
      const q = m[5];
      if (q)
        ch =
          (q[0] === "+" ? 1 : -1) *
          (q.length > 1 && /^\d+$/.test(q.slice(1))
            ? parseInt(q.slice(1))
            : q.length);
      a = add(el[0].toUpperCase() + el.slice(1).toLowerCase(), el[0] >= "a" && el[0] <= "z", ch);
    } else if (c === "(") {
      stack.push(prev);
      i++;
      continue;
    } else if (c === ")") {
      prev = stack.pop();
      i++;
      continue;
    } else if ("-=#:/\\".includes(c)) {
      pend = { "-": 1, "=": 2, "#": 3, ":": 1.5, "/": 1, "\\": 1 }[c] ?? 1;
      i++;
      continue;
    } else if (c === ".") {
      prev = null;
      i++;
      continue;
    } else if (/[0-9%]/.test(c)) {
      let n: number;
      if (c === "%") {
        n = parseInt(s.slice(i + 1, i + 3));
        i += 3;
      } else {
        n = parseInt(c);
        i++;
      }
      if (n in rings) {
        const [a0, o0] = rings[n];
        delete rings[n];
        const o =
          pend || o0 || (at[a0][1] && at[prev!][1] ? 1.5 : 1);
        bond(a0, prev!, o as number);
      } else rings[n] = [prev, pend];
      pend = null;
      continue;
    } else {
      const two = s.slice(i, i + 2);
      const el = ORG.includes(two) ? two : c;
      i += el.length;
      a = add(el[0].toUpperCase() + el.slice(1).toLowerCase(), el[0] >= "a" && el[0] <= "z", 0);
    }
    if (prev !== null) {
      const o = pend || (at[prev][1] && at[a][1] ? 1.5 : 1);
      bond(prev, a, o as number);
    }
    prev = a;
    pend = null;
  }
  return [at, adj];
}

export function ecfp(s: string, n = 1024, r = 2): Float32Array {
  const [at, adj] = smiParse(s);
  let ids = at.map((a, k) =>
    crc32(`${a[0]}${a[1] ? 1 : 0}${a[2]}${adj[k].length}`)
  );
  const out = new Float32Array(n);
  for (const x of ids) out[x % n]++;
  for (let t = 0; t < r; t++) {
    ids = ids.map((_, k) =>
      crc32(
        String(ids[k]) +
          "|" +
          adj[k]
            .map(([b, o]) => `${o}:${ids[b]}`)
            .sort()
            .join(",")
      )
    );
    for (const x of ids) out[x % n]++;
  }
  return out;
}
