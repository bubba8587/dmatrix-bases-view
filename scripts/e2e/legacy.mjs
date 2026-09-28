// Converting a Decision Matrix 0.7 decision: 0.7's own example (loose score properties, weight_* on the
// decision note, a base whose order lists the criteria), converted through the view. Run by `rig.mjs run`.
import puppeteer from "puppeteer-core";

const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.RIG_PORT ?? 9333}`, defaultViewport: null });
const page = (await b.pages()).find((p) => p.url().startsWith("app://"));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push(!!ok); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };

console.log("── Conversion from 0.7");
await page.evaluate(async () => {
  const dir = "Legacy";
  const f = app.vault.getAbstractFileByPath(dir); if (f) await app.vault.delete(f, true);
  await app.vault.createFolder(dir);
  const laptops = [["Laptop A", 1200, 7, 6, 9, 7], ["Laptop B", 950, 9, 4, 8, 5], ["Laptop C", 800, 5, 9, 7, 9], ["Laptop D", 1600, 8, 7, 9, 8]];
  for (const [n, cost, perf, port, bq, bat] of laptops) {
    await app.vault.create(`${dir}/${n}.md`, `---\ntitle: ${n}\ncost: ${cost}\nperformance: ${perf}\nportability: ${port}\nbuild_quality: ${bq}\nbattery: ${bat}\n---\n\nNotes.\n`);
  }
  const filters = `    filters:\n      and:\n        - file.folder == "${dir}"\n        - 'file.ext == "md"'\n        - file.name != this.file.name\n        - 'file.name != "Laptop Decision"'\n`;
  await app.vault.create(`${dir}/laptop-comparison.base`, `views:\n  - type: decision-matrix\n    name: Laptop Comparison\n${filters}    order:\n      - title\n      - cost\n      - performance\n      - portability\n      - build_quality\n      - battery\n`);
  const d = await app.vault.create(`${dir}/Laptop Decision.md`, `---\ntitle: Laptop Decision\nweight_cost: -3\nweight_performance: 5\nweight_portability: 2\nweight_build_quality: 4\nweight_battery: 3\n---\n\n![[laptop-comparison.base]]\n`);
  await app.workspace.getLeaf(false).openFile(d);
});
await w(3500);
const M = ".workspace-leaf.mod-active .dmv-root";
check("A 0.7 decision offers Convert to frames", await page.evaluate((M) => [...document.querySelectorAll(`${M} button`)].some((x) => x.textContent === "Convert to frames"), M));
await page.evaluate((M) => [...document.querySelectorAll(`${M} button`)].find((x) => x.textContent === "Convert to frames").click(), M);
await w(500);
const confirm = await page.$eval(".modal", (m) => m.innerText);
check("The confirmation names what moves", /cost, performance, portability, build_quality, battery move into the scores frame on 4 notes/.test(confirm));
await page.evaluate(() => [...document.querySelectorAll(".modal button")].find((x) => x.textContent === "Convert").click());
await w(3500);
const out = await page.evaluate(async () => {
  const fm = (p) => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(`Legacy/${p}.md`)).frontmatter;
  const p = app.plugins.getPlugin("solenoid-properties");
  const types = p.api ? { scores: p.api.columnTypes("scores"), weights: p.api.columnTypes("weights") } : (await p.loadData()).columnTypes;
  return { a: fm("Laptop A"), decision: fm("Laptop Decision"), types, rows: document.querySelectorAll(".workspace-leaf.mod-active .dmv-row").length };
});
check("Each note's values moved into its scores frame", JSON.stringify(out.a.scores) === JSON.stringify([{ cost: 1200, performance: 7, portability: 6, build_quality: 9, battery: 7 }]) && !("cost" in out.a));
check("weight_ properties moved into the weights frame", out.decision.weights?.length === 5 && out.decision.weights[0].Weight === -3 && !("weight_cost" in out.decision));
check("Converted columns are typed Number", ["cost", "performance", "portability", "build_quality", "battery"].every((c) => out.types.scores[c] === "number"));
check("The matrix renders after converting", out.rows === 4);
check("No console errors", errors.length === 0, errors.slice(0, 3).join(" | "));
console.log(`── ${results.filter(Boolean).length}/${results.length} passed`);
await b.disconnect();
process.exit(results.every(Boolean) ? 0 : 1);
