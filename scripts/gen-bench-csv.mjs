// Generates deterministic source/target CSV pairs for benchmarking.
// Usage: node scripts/gen-bench-csv.mjs <outDir> <rows> [label]
// Target = source with ~5% rows modified, ~2% removed, ~2% added (order kept).
import { createWriteStream, mkdirSync } from "node:fs";
import { once } from "node:events";
import { join } from "node:path";

const [outDir, rowsArg, labelArg] = process.argv.slice(2);
if (!outDir || !rowsArg) {
  console.error("usage: gen-bench-csv.mjs <outDir> <rows> [label]");
  process.exit(1);
}
const rows = Number(rowsArg);
const label = labelArg ?? `${rows}`;
mkdirSync(outDir, { recursive: true });

// mulberry32: small seeded PRNG so runs are reproducible
const prng = (seed) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const FIRST = ["John", "Jane", "Alice", "Bob", "Eve", "Frank", "Grace", "Henry", "Ivy", "Jack", "Karen", "Liam", "Mia", "Noah", "Olivia", "Paul"];
const LAST = ["Doe", "Smith", "Brown", "Wilson", "Lee", "Kim", "Chen", "Miller", "Davis", "White", "Garcia", "Martin", "Lopez", "Clark"];
const DEPT = ["Engineering", "Design", "Sales", "Marketing", "Finance", "HR", "Customer Service", "Legal"];
const CITY = ["Berlin", "Paris", "London", "New York", "Tokyo", "Sydney", "Toronto", "Madrid"];
const STATUS = ["active", "inactive", "pending", "suspended"];
const WORDS = ["lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit", "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "magna", "aliqua"];

const pick = (r, a) => a[Math.floor(r() * a.length)];
const HEADER =
  "id,first_name,last_name,email,department,city,status,salary,score,hired_at,active,notes";

const makeRow = (id, r) => {
  const f = pick(r, FIRST);
  const l = pick(r, LAST);
  const nw = 3 + Math.floor(r() * 8);
  let notes = "";
  for (let i = 0; i < nw; i++) notes += (i ? " " : "") + pick(r, WORDS);
  // ~3% of notes need quoting (comma + embedded quote)
  if (r() < 0.03) notes = `"${notes}, with ""quoted"" text"`;
  const d = new Date(Date.UTC(2015, 0, 1) + Math.floor(r() * 3650) * 86400000)
    .toISOString()
    .slice(0, 10);
  return [
    id, f, l, `${f}.${l}${id}@example.com`.toLowerCase(), pick(r, DEPT), pick(r, CITY),
    pick(r, STATUS), 30000 + Math.floor(r() * 120000), (r() * 100).toFixed(2), d,
    r() < 0.8 ? "true" : "false", notes,
  ];
};

const src = createWriteStream(join(outDir, `source_${label}.csv`));
const tgt = createWriteStream(join(outDir, `target_${label}.csv`));
src.write(HEADER + "\n");
tgt.write(HEADER + "\n");

const r = prng(42);
const mut = prng(1337);
let nextNewId = rows + 1;
let srcBytes = HEADER.length + 1;
let tgtBytes = HEADER.length + 1;
const stats = { modified: 0, removed: 0, added: 0 };

const w = async (s, str) => {
  if (!s.write(str)) await once(s, "drain");
};

for (let id = 1; id <= rows; id++) {
  const cols = makeRow(id, r);
  const line = cols.join(",") + "\n";
  await w(src, line);
  srcBytes += line.length;

  const p = mut();
  if (p < 0.02) {
    stats.removed++;
  } else if (p < 0.07) {
    const c = cols.slice();
    const n = 1 + Math.floor(mut() * 3);
    for (let k = 0; k < n; k++) {
      const idx = 4 + Math.floor(mut() * 6); // department..hired_at
      c[idx] = idx === 7 ? c[7] + 1000 : `${c[idx]}_x`;
    }
    const tl = c.join(",") + "\n";
    await w(tgt, tl);
    tgtBytes += tl.length;
    stats.modified++;
  } else {
    await w(tgt, line);
    tgtBytes += line.length;
  }

  if (mut() < 0.02) {
    const tl = makeRow(nextNewId++, mut).join(",") + "\n";
    await w(tgt, tl);
    tgtBytes += tl.length;
    stats.added++;
  }
}
src.end();
tgt.end();
await Promise.all([once(src, "finish"), once(tgt, "finish")]);
console.log(
  JSON.stringify({
    label,
    rows,
    srcMB: +(srcBytes / 1048576).toFixed(1),
    tgtMB: +(tgtBytes / 1048576).toFixed(1),
    ...stats,
  }),
);
