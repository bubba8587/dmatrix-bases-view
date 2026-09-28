// Parity fuzz: this plugin's scoring against Solenoid's own engine, on random messy decisions.
//   SOLENOID=../solenoid npm run parity [-- <seed> <count>]
// Bundles decisionMatrix, resolveDecisionWeights, guessNoteColumnType and coerceFrameCell from a Solenoid
// checkout with esbuild. Their dependencies resolve from $SOLENOID/node_modules, or set NODE_PATH to a
// node_modules that has them (Solenoid Properties' works).
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scoreTable } from "../src/scores.ts";
import { resolveWeights } from "../src/weights.ts";
import { fillBlanks, scoreMatrix } from "../src/scoring.ts";

const SOLENOID = path.resolve(process.env.SOLENOID ?? "../solenoid");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dm-parity-"));
fs.writeFileSync(path.join(tmp, "entry.ts"), [
  `export { decisionMatrix, resolveDecisionWeights, decisionCriteria } from "${SOLENOID}/src/graph/frameVerbs";`,
  `export { guessNoteColumnType, coerceFrameCell } from "${SOLENOID}/src/graph/frame";`,
].join("\n"));
execFileSync(path.resolve("node_modules/.bin/esbuild"), [path.join(tmp, "entry.ts"), "--bundle", "--format=esm", "--platform=node", `--outfile=${path.join(tmp, "solenoid.mjs")}`, "--log-level=error"], {
  stdio: "inherit",
  env: { ...process.env, NODE_PATH: process.env.NODE_PATH ?? path.join(SOLENOID, "node_modules") },
});
const sol = await import(path.join(tmp, "solenoid.mjs"));

let seed = Number(process.argv[2] ?? 1);
const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const chance = (p) => rnd() < p;

// Solenoid's rowsToFrame (src/graph/nodes/annotation.ts), glue only: the typing and coercion are Solenoid's own.
function rowsToFrame(rows, picks = {}) {
  const names = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!names.includes(k)) names.push(k);
  const columns = names.map((name) => {
    const cells = rows.map((r) => { const v = name in r ? r[name] : null; if (!Array.isArray(v)) return v; const f = v[0] ?? null; return typeof f === "object" ? null : f; });
    const isDate = (v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v);
    const type = picks[name] ?? sol.guessNoteColumnType(cells, isDate);
    const raw = cells.map((c) => (c === null || c === undefined ? "" : typeof c === "boolean" ? (c ? "TRUE" : "FALSE") : String(c)));
    return { name, type, values: raw.map((r) => sol.coerceFrameCell(type, r)), raw };
  });
  return { __frame: true, columns };
}

const NOISE = () => pick(["n/a", "12", "1,200", " 7 ", "-3.5", "1e2", "TRUE", "2026-01-02", true, false, [4, 5], "", null, "0x10", "Infinity"]);
const cellOf = (fam) => {
  if (chance(0.12)) return NOISE();
  if (chance(0.1)) return null;
  switch (fam) {
    case "int": return Math.floor(rnd() * 25) - 5;
    case "dec": return Math.round(rnd() * 1000) / 100;
    case "big": return Math.floor(rnd() * 3000);
    case "tie": return pick([1, 2, 2, 3]);
    case "bool": return chance(0.5);
    case "text": return pick(["Acme", "Globex", "Initech"]);
    case "date": return pick(["2026-01-02", "2025-12-31"]);
  }
};

let cases = 0, fails = 0;
const N = Number(process.argv[3] ?? 3000);
for (let t = 0; t < N; t++) {
  const nOpt = 1 + Math.floor(rnd() * 7), nCol = 1 + Math.floor(rnd() * 6);
  const cols = Array.from({ length: nCol }, (_, j) => ({ name: pick(["cost", "Speed", "risk", "fun", "size", "noise", "Score", "Rank", "vendor", "day"]) + (j ? j : ""), fam: pick(["int", "dec", "big", "tie", "bool", "bool", "text", "date"]) }));
  const rows = Array.from({ length: nOpt }, () => Object.fromEntries(cols.filter(() => !chance(0.08)).map((c) => [c.name, cellOf(c.fam)])));
  const scorePicks = Object.fromEntries(cols.filter(() => chance(0.2)).map((c) => [c.name, pick(["number", "logical", "string", "date"])]));

  // Plugin
  const table = scoreTable(rows, scorePicks);
  if (table.columns.length === 0) continue;
  const crit = table.columns.map((c) => ({ name: c.name, label: c.name }));
  const variant = (n) => pick([n, n.toUpperCase(), ` ${n} `, n.toLowerCase()]);
  const wKey = pick(["Weight", "weight", "Value", "Weights", "W"]);
  const wRows = [...crit.filter(() => chance(0.8)).map((c) => c.name), ...(chance(0.3) ? ["ghost"] : [])].map((n) => {
    const r = { Criterion: variant(n) };
    if (chance(0.3)) r.Order = Math.floor(rnd() * 5);
    r[wKey] = chance(0.85) ? pick([-3, -1, 0, 0.5, 1, 2, 5, 10]) : pick(["x", "4", true, null, ""]);
    r.Norm = pick(["Raw", "÷Max", "÷ max", "rank", "none", "divmax", "junk", null, 3, ""]);
    return r;
  });
  if (chance(0.1)) for (const r of wRows) delete r.Criterion;
  const weightPicks = chance(0.2) ? { [wKey]: "number" } : {};
  const normalize = pick(["none", "max", "rank"]);
  const resolved = resolveWeights(wRows.length ? wRows : null, crit, weightPicks);
  const filled = fillBlanks(crit.map((_, j) => table.cells.map((c) => c[j])), table.columns.map((c) => c.logical));
  const mine = scoreMatrix({ columns: filled.columns, weights: resolved.weights, norms: resolved.norms, normalize });

  // Solenoid: the stacked Scores frame with a label column first, then the Weights frame.
  const labels = rows.map((_, i) => `opt${i}`);
  const sf = rowsToFrame(rows.map((r, i) => ({ __label: labels[i], ...r })), scorePicks);
  const solCrit = sol.decisionCriteria(sf);
  // The plugin scores a blank number as its criterion's median, where Solenoid scores 0: fill Solenoid's
  // blanks the same way first (an independent median), so the rest of the rules are compared exactly.
  for (const col of sf.columns) {
    if (col.type !== "number" || !solCrit.includes(col.name)) continue;
    const v = col.values.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
    if (!v.length) continue;
    const med = v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2;
    col.values = col.values.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : x === null || typeof x === "number" ? med : x));
  }
  const wf = wRows.length ? rowsToFrame(wRows, weightPicks) : null;
  const { weights, normOverrides } = sol.resolveDecisionWeights(wf, solCrit);
  cases++;
  const problems = [];
  if (JSON.stringify(solCrit) !== JSON.stringify(crit.map((c) => c.name))) problems.push(`criteria ${JSON.stringify(solCrit)} vs ${JSON.stringify(crit.map((c) => c.name))}`);
  else {
    const out = sol.decisionMatrix(sf, weights, normalize, true, normOverrides);
    const label = out.columns[0].values, score = out.columns.at(-2).values, rank = out.columns.at(-1).values;
    label.forEach((l, k) => {
      const i = labels.indexOf(l);
      if (mine.scores[i] !== score[k]) problems.push(`${l} score ${mine.scores[i]} vs ${score[k]}`);
      if (mine.ranks[i] !== rank[k]) problems.push(`${l} rank ${mine.ranks[i]} vs ${rank[k]}`);
      crit.forEach((_, j) => { if (mine.contributions[j][i] !== out.columns[1 + j].values[k]) problems.push(`${l} contribution ${j} ${mine.contributions[j][i]} vs ${out.columns[1 + j].values[k]}`); });
    });
  }
  if (problems.length) {
    fails++;
    if (fails <= 4) console.log(`case ${t}:`, problems.slice(0, 4).join("; "), "\n  rows", JSON.stringify(rows), "\n  picks", JSON.stringify(scorePicks), "\n  weights", JSON.stringify(wRows), JSON.stringify(weightPicks), normalize);
  }
}
console.log(`${cases} decisions compared, ${fails} disagree`);
process.exit(fails ? 1 : 0);
