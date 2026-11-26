/**
 * Looks over the example stores' product-line tables (demo-catalog-*.mjs):
 *
 *   node backend/scripts/demo-catalog-check.mjs                 each department's reach against its quota
 *   node backend/scripts/demo-catalog-check.mjs --sample DAIRY  made-up names from departments matching "DAIRY"
 *   node backend/scripts/demo-catalog-check.mjs --tidy          drop kind lines that are not whole (says which)
 *   node backend/scripts/demo-catalog-check.mjs --add walmart BLOCK   put a department block into a store's table (rolled back if it does not load)
 *   node backend/scripts/demo-catalog-check.mjs --scan               rows whose product word is printed twice ("Toothpaste Gel Toothpaste")
 *
 * "Reach" is how many distinct products a department's rows can form at most.
 * A department that cannot form its quota makes the generator throw, so this
 * is the check to run after editing a table.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";


const HERE = dirname(fileURLToPath(import.meta.url));
const STORES = { "walmart-example": "walmart", "home-depot-example": "homedepot", "convenience-store-example": "corner" };
const KIND_FILES = ["demo-catalog-kinds-grocery.mjs", "demo-catalog-kinds-general.mjs", "demo-catalog-kinds-hardware.mjs"];
const load = (file) => import(pathToFileURL(resolve(HERE, file)).href);

/** A kind line is whole when it parses and runs on its own under the real vocabulary. */
function wholeKindLine(line, declared) {
  const probe = join(tmpdir(), `storemap-kind-probe-${process.pid}.mjs`);
  writeFileSync(probe, `import { BY, kind, PACKS, SINGLE } from ${JSON.stringify(join(HERE, "demo-catalog-kit.mjs"))};\n${declared}\n${line}\n`);
  return spawnSync(process.execPath, [probe], { encoding: "utf8" }).status === 0;
}

function tidy(force) {
  for (const file of KIND_FILES) {
    const path = join(HERE, file);
    const lines = readFileSync(path, "utf8").split("\n");
    const declared = lines.filter((l) => /^const [A-Z_]+ = /.test(l)).join("\n");
    // The probe is tried with no kind line first: a header that does not run
    // would fail every line, which is how a whole table was once wiped.
    if (!wholeKindLine("", declared)) {
      console.log(`${file}: its own constants do not run — nothing touched`);
      continue;
    }
    const kinds = lines.filter((l) => l.startsWith("kind("));
    const bad = kinds.filter((l) => !wholeKindLine(l, declared));
    if (!bad.length) {
      console.log(`${file}: every kind line is whole`);
    } else if (!force && bad.length > kinds.length / 4) {
      console.log(`${file}: ${bad.length} of ${kinds.length} kind lines are broken — too many to drop without --force; nothing touched`);
    } else {
      writeFileSync(path, lines.filter((l) => !bad.includes(l)).join("\n"));
      console.log(`${file}: dropped ${bad.length}: ${bad.map((l) => l.slice(0, 22)).join(", ")}`);
    }
  }
}

/**
 * Rows that name their product ("Toothpaste~…") while their kind repeats that
 * word as a grade or flavour, so the made-up name prints it twice — or pairs
 * the row's product with another one from the kind ("Garden Hoses Fertilizers").
 */
async function scan() {
  const { lineCapacity } = await load("demo-catalog.mjs");
  const words = (text) => new Set(text.toLowerCase().match(/[a-z0-9']+/g) ?? []);
  let flagged = 0;
  for (const [slug, file] of Object.entries(STORES)) {
    const table = (await load(`demo-catalog-${file}.mjs`)).default;
    for (const [dept, rows] of Object.entries(table)) {
      for (const line of rows) {
        const product = line.products[0];
        if (!product.base) continue;
        const base = words(product.base);
        const clash = (list) => list.find((word) => words(word).size && [...words(word)].some((w) => w.length > 2 && base.has(w)));
        const hit = clash(product.flavours) ?? clash(product.grades);
        if (!hit) continue;
        flagged++;
        const brand = line.brands[0];
        const other = product.grades.find((g) => g && g !== hit && ![...base].some((w) => words(g).has(w)));
        console.log(`${file} / ${dept}: ${product.base || "(no product word)"} × "${hit}"${other ? ` (also × "${other}")` : ""} — e.g. "${[brand, product.flavours[0] || "", product.base, other ?? hit, product.sizes[0]].filter(Boolean).join(" ")}"`);
      }
    }
  }
  console.log(`\n${flagged} row(s) print their product word twice`);
}

/** Put a `"Department": D(\`…\`),` block (a file) at the end of a store's table; undone if the table then fails to load. */
async function add(store, blockFile) {
  const file = join(HERE, `demo-catalog-${store}.mjs`);
  const before = readFileSync(file, "utf8");
  const block = readFileSync(blockFile, "utf8").replace(/\s+$/, "");
  const end = before.lastIndexOf("\n};");
  if (end < 0) throw new Error(`${file}: table closing not found`);
  writeFileSync(file, `${before.slice(0, end)}\n${block}${before.slice(end)}`);
  try {
    await import(pathToFileURL(file).href + `?t=${Date.now()}`);
  } catch (err) {
    writeFileSync(file, before);
    console.log(`not added — ${err.message}`);
    process.exit(1);
  }
  console.log(`added ${basename(blockFile)} to ${store}`);
}

async function report() {
  // loaded here, not at the top, so that --tidy can run on files that do not load yet
  const { lineCapacity, STORE_SHARES, STORE_TOTALS } = await load("demo-catalog.mjs");
  let allGood = true;
  for (const [slug, file] of Object.entries(STORES)) {
    let table;
    try {
      table = (await load(`demo-catalog-${file}.mjs`)).default;
    } catch (err) {
      allGood = false;
      console.log(`${file}: does not load — ${err.message}`);
      continue;
    }
    const total = STORE_TOTALS[slug];
    const sum = Object.values(STORE_SHARES[slug]).reduce((a, b) => a + b, 0);
    console.log(`\n${file} (${total.toLocaleString()} SKUs)`);
    for (const [dept, share] of Object.entries(STORE_SHARES[slug])) {
      const quota = Math.floor((total * share) / sum);
      const rows = table[dept] ?? [];
      const reach = rows.reduce((n, line) => n + lineCapacity(line), 0);
      const ok = rows.length > 0 && reach >= quota * 1.5;
      if (!ok) allGood = false;
      console.log(`  ${ok ? "ok " : "LOW"} ${dept.padEnd(22)} rows ${String(rows.length).padStart(2)}  reach ${reach.toLocaleString().padStart(10)}  quota ~${quota.toLocaleString().padStart(6)}`);
    }
  }
  process.exit(allGood ? 0 : 1);
}

async function sample(match, n = 6) {
  const { KINDS } = await load("demo-catalog-kit.mjs");
  const hash = (x) => {
    x = Math.imul(x ^ (x >>> 16), 0x21f0aaad);
    x = Math.imul(x ^ (x >>> 15), 0x735a2d97);
    return (x ^ (x >>> 15)) >>> 0;
  };
  const pick = (list, k) => list[hash(k * 2654435761) % list.length];
  let seed = 7;
  for (const [slug, file] of Object.entries(STORES)) {
    const table = await load(`demo-catalog-${file}.mjs`).then((m) => m.default, () => ({}));
    for (const [dept, rows] of Object.entries(table)) {
      if (!dept.toUpperCase().includes(match.toUpperCase())) continue;
      console.log(`\n${file} / ${dept}`);
      for (const line of rows) {
        const shown = [];
        for (let i = 0; i < n; i++) {
          const p = pick(line.products, seed++);
          const [lo, hi] = line.price;
          const name = [pick(line.brands, seed++), pick(p.flavours, seed++), p.base, pick(p.grades, seed++), pick(p.sizes, seed++), pick(line.packs, seed++)].filter(Boolean).join(" ");
          shown.push(`${name}  ($${(lo + (hash(seed++) % 1000 / 1000) * (hi - lo)).toFixed(2)})`);
        }
        console.log(`  ${line.products[0].base || "(no product word)"}: ${shown.join(" | ")}`);
      }
    }
  }
  console.log(`\n${KINDS.size} kinds defined`);
}

const [flag, a, b, force] = process.argv.slice(2);
if (flag === "--tidy") tidy(force === "--force");
else if (flag === "--add") await add(a, resolve(b));
else if (flag === "--scan") await scan();
else if (flag === "--sample") await sample(a ?? "", Number(b ?? 6));
else await report();
