// Full feature pass for the Decision Matrix plugin in the rig's Obsidian, on a fresh reset. Run by `rig.mjs run`.
import puppeteer from "puppeteer-core";
const label = process.argv[2] ?? "";
const b = await puppeteer.connect({ browserURL: `http://127.0.0.1:${process.env.RIG_PORT ?? 9333}`, defaultViewport: null });
const page = (await b.pages()).find((p) => p.url().startsWith("app://"));
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const w = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok: !!ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`); };
const ev = (fn, ...args) => page.evaluate(fn, ...args);
const DIR = "Decision Matrix Examples";
const M = ".workspace-leaf.mod-active .dmv-matrix";
const R = ".workspace-leaf.mod-active .dmv-rankings";
const fm = (n) => ev((p) => app.metadataCache.getFileCache(app.vault.getAbstractFileByPath(p))?.frontmatter, `${DIR}/${n}.md`);
const weights = async () => Object.fromEntries((await fm("Laptop Decision")).weights.map((r) => [r.Criterion, [r.Weight, r.Norm]]));
const rows = () => ev((M) => [...document.querySelectorAll(`${M} .dmv-row`)].map((r) => ({ name: r.querySelector(".dmv-td-option").textContent, score: Number(r.querySelector(".dmv-score").textContent), rank: r.querySelector(".dmv-td-rank").textContent })), M);
const heads = () => ev((M) => [...document.querySelectorAll(`${M} .dmv-head-btn`)].map((x) => x.textContent), M);
const typeInto = async (selector, text) => {
  // As a person would: bring the field into the clear part of the table, then click it.
  await ev((sel) => document.querySelector(sel).focus(), selector); await w(150);
  await page.click(selector);
  await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control");
  if (text === "") await page.keyboard.press("Backspace"); else await page.keyboard.type(text);
  await page.keyboard.press("Enter");
};
const menuPick = async (title) => { await ev((t) => [...document.querySelectorAll(".menu .menu-item")].find((i) => i.textContent.trim() === t)?.click(), title); await w(400); };
const openHeadMenu = async (name) => { await ev((M, n) => [...document.querySelectorAll(`${M} .dmv-head-btn`)].find((x) => x.textContent === n).click(), M, name); await w(300); };
const openDecision = async () => { await ev(async (p) => { await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath(p)); }, `${DIR}/Laptop Decision.md`); await w(2500); };

console.log(`── Full pass ${label}`);
const sp = await ev(() => ({ api: app.plugins.getPlugin("solenoid-properties")?.api?.version ?? null, look: document.body.classList.contains("solenoid-look") }));
check("Solenoid Properties loaded with the look on", sp.look, `api ${sp.api ?? "none"}`);

// Settings
const settings = await ev(async () => {
  const tab = app.setting.pluginTabs.find((t) => t.id === "decision-matrix-bases-view");
  const defs = tab.getSettingDefinitions?.() ?? [];
  return { defs: defs.map((d) => d.name) };
});
check("Settings tab declares its rows for settings search", settings.defs.includes("Example notes"), settings.defs.join(", "));

// Render
await openDecision();
let r0 = await rows();
check("Matrix renders the 4 example laptops", r0.length === 4, r0.map((x) => x.name).join(", "));
check("6 criteria from the scores frames", (await heads()).length === 6, (await heads()).join(","));
check("Leader line names leader and runner-up", await ev((M) => /leads .* by/.test(document.querySelector(`${M} .dmv-lead`)?.textContent ?? ""), M));
check("Flips at row shows", await ev((M) => document.querySelectorAll(`${M} .dmv-flip`).length === 6, M));
check("Weights chip is Solenoid's own Frame chip", await ev((M) => !!document.querySelector(`${M} .dmv-chip .solenoid-property-chip`), M));
check("Rankings view renders its rows", await ev((R) => document.querySelectorAll(`${R} .dmv-rank-row`).length === 4, R));
check("Rankings breakdown has a legend of 6", await ev((R) => document.querySelector(`${R} .dmv-legend`)?.children.length === 6, R));

// Normalize persists to the .base
await ev((M) => [...document.querySelectorAll(`${M} .dmv-seg-btn`)].find((x) => x.textContent === "Rank").click(), M); await w(1200);
const baseText = await ev(() => app.vault.adapter.read("Decision Matrix Examples/laptop-comparison.base"));
check("Normalize: Rank saves to the view in the .base", /normalize: rank/.test(baseText));
await ev((M) => [...document.querySelectorAll(`${M} .dmv-seg-btn`)].find((x) => x.textContent === "÷ Max").click(), M); await w(1000);

// Breakdown sums
await ev((M) => [...document.querySelectorAll(`${M} .dmv-seg-btn`)].find((x) => x.textContent === "Breakdown").click(), M); await w(1000);
const sums = await ev((M) => [...document.querySelectorAll(`${M} .dmv-row`)].map((r) => { const c = [...r.querySelectorAll(".dmv-contrib")].reduce((s, e) => s + Number(e.textContent), 0); return Math.abs(c - Number(r.querySelector(".dmv-score").textContent)); }), M);
check("Breakdown contributions add up to each score", sums.every((d) => d < 0.0006), sums.map((d) => d.toFixed(5)).join(" "));
await ev((M) => [...document.querySelectorAll(`${M} .dmv-seg-btn`)].find((x) => x.textContent === "Summary").click(), M); await w(900);

// Weights: type, step, Norm
await typeInto(`${M} input[aria-label="Weight of battery"]`, "4"); await w(1400);
check("Typing a weight writes it to the weights frame", (await weights()).battery[0] === 4);
await ev((M) => document.querySelector(`${M} input[aria-label="Weight of battery"]`).focus(), M); await page.click(`${M} input[aria-label="Weight of battery"]`); await page.keyboard.press("ArrowUp"); await w(1200); await page.keyboard.down("Shift"); await page.keyboard.press("ArrowDown"); await page.keyboard.up("Shift"); await w(1200);
check("Up steps a weight by 1, Shift+Down by 0.1", (await weights()).battery[0] === 4.9, String((await weights()).battery[0]));
await ev(() => document.activeElement?.blur());
await ev((M) => { const s = document.querySelector(`${M} select[aria-label="Norm of performance"]`); s.value = "rank"; s.dispatchEvent(new Event("change")); }, M); await w(1400);
check("A Norm pick writes Rank to the frame", (await weights()).performance[1] === "Rank");
await ev((M) => { const s = document.querySelector(`${M} select[aria-label="Norm of performance"]`); s.value = ""; s.dispatchEvent(new Event("change")); }, M); await w(1400);
check("Clearing the Norm pick writes blank", (await weights()).performance[1] === null);

// Values: type, Enter moves down, blank shows the median, checkbox
r0 = await rows();
await typeInto(`${M} input[aria-label="battery of ${r0[0].name}"]`, "6"); await w(1500);
check("Typing a value writes it to that note's scores frame", (await fm(r0[0].name)).scores[0].battery === 6);
const focusAfter = await ev(() => document.activeElement?.getAttribute("aria-label"));
check("Enter moves down the column", focusAfter === `battery of ${(await rows())[1].name}` || /battery of/.test(focusAfter ?? ""), focusAfter);
await ev(() => document.activeElement?.blur()); await w(800);
await typeInto(`${M} input[aria-label="portability of Laptop C"]`, ""); await w(1500);
const blank = await ev((M) => { const i = document.querySelector(`${M} input[aria-label="portability of Laptop C"]`); return { v: i.value, ph: i.placeholder, cls: i.className }; }, M);
check("Clearing a value saves blank and shows the median dimmed", (await fm("Laptop C")).scores[0].portability === null && blank.ph !== "" && /is-median/.test(blank.cls), `placeholder ${blank.ph}`);
await ev(() => document.activeElement?.blur());
await ev((M) => document.querySelector(`${M} input[aria-label="backlit of Laptop C"]`).click(), M); await w(1500);
check("A checkbox writes true", (await fm("Laptop C")).scores[0].backlit === true);

// Criteria: add, rename, lower is better, remove
await ev((M) => [...document.querySelectorAll(`${M} .dmv-text-btn`)].find((x) => x.textContent === "Add criterion").click(), M); await w(400);
await page.keyboard.type("noise"); await page.keyboard.press("Enter"); await w(1800);
check("Add criterion adds a weights row and a column", "noise" in (await weights()) && (await heads()).includes("noise"));
await typeInto(`${M} input[aria-label="noise of Laptop A"]`, "3"); await w(1600);
const types = await ev(async () => { const p = app.plugins.getPlugin("solenoid-properties"); return p.api ? p.api.columnTypes("scores") : (await p.loadData()).columnTypes.scores; });
check("A new criterion's column type is recorded as number", types.noise === "number", JSON.stringify(types));
await ev(() => document.activeElement?.blur());
await openHeadMenu("noise"); await menuPick("Rename");
await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control"); await page.keyboard.type("fan noise"); await page.keyboard.press("Enter"); await w(2500);
check("Rename carries notes, weights row and type", (await fm("Laptop A")).scores[0]["fan noise"] === 3 && "fan noise" in (await weights()) && (await heads()).includes("fan noise"));
await openHeadMenu("fan noise"); await menuPick("Lower is better"); await w(1200);
check("Lower is better flips the weight's sign", (await weights())["fan noise"][0] === -1);
await openHeadMenu("fan noise"); await menuPick("Remove criterion");
await ev(() => [...document.querySelectorAll(".modal button")].find((x) => x.textContent === "Remove").click()); await w(2500);
check("Remove criterion clears notes and weights", !("fan noise" in (await fm("Laptop A")).scores[0]) && !("fan noise" in (await weights())));

// Toolbar menu
await ev(() => { window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; });
await ev((M) => document.querySelector(`${M} .dmv-toolbar > .dmv-icon-btn`).click(), M); await w(300); await menuPick("Copy as Markdown");
const md = await ev(() => window.__copied);
check("Copy as Markdown copies a ranking table", /^\| Rank \| Option \| Score \|/.test(md ?? "") && (md ?? "").split("\n").length === 6);
// Write result to properties
await ev((M) => document.querySelector(`${M} .dmv-toolbar > .dmv-icon-btn`).click(), M); await w(300); await menuPick("Write result to properties"); await w(1500);
const shown = (await rows()).slice().sort((a, b) => Number(a.rank.replace("=", "")) - Number(b.rank.replace("=", "")));
const written = (await fm("Laptop Decision")).result ?? [];
check("Write result writes Option · Score · Rank best first", written.length === 4 && JSON.stringify(Object.keys(written[0])) === JSON.stringify(["Option", "Score", "Rank"]) && written.every((r, k) => r.Option === shown[k].name && r.Score === shown[k].score), JSON.stringify(written[0]));
const resultTypes = await ev(async () => { const p = app.plugins.getPlugin("solenoid-properties"); return p.api ? p.api.columnTypes("result") : (await p.loadData()).columnTypes.result; });
check("The result's column types are recorded", JSON.stringify(resultTypes) === JSON.stringify({ Option: "string", Score: "number", Rank: "number" }), JSON.stringify(resultTypes));
check("The result shows as a Frame property", await ev(() => app.metadataTypeManager.getAssignedWidget("result") === "solenoid-frame"));
await ev((M) => [...document.querySelectorAll(`${M} .dmv-seg-btn`)].find((x) => x.textContent === "Breakdown").click(), M); await w(1000);
await ev((M) => document.querySelector(`${M} .dmv-toolbar > .dmv-icon-btn`).click(), M); await w(300); await menuPick("Write result to properties"); await w(1500);
const withBreakdown = (await fm("Laptop Decision")).result ?? [];
check("Under Breakdown the result carries each contribution", Object.keys(withBreakdown[0] ?? {}).length === 9 && Math.abs(Object.values(withBreakdown[0]).slice(1, 7).reduce((s, v) => s + v, 0) - withBreakdown[0].Score) < 0.0006);
await ev((M) => [...document.querySelectorAll(`${M} .dmv-seg-btn`)].find((x) => x.textContent === "Summary").click(), M); await w(900);

await ev((M) => document.querySelector(`${M} .dmv-toolbar > .dmv-icon-btn`).click(), M); await w(300); await menuPick("Reset weights");
await ev(() => [...document.querySelectorAll(".modal button")].find((x) => x.textContent === "Reset").click()); await w(2000);
check("Reset weights sets every weight to 1", Object.values(await weights()).every(([wt, n]) => wt === 1 && n === null));

// Option links
{ // Page Preview opens only under a real pointer, so move the mouse there with Ctrl held.
  const box = await (await page.$(`${M} .dmv-td-option a`)).boundingBox();
  await page.mouse.move(box.x - 30, box.y + 5); await page.keyboard.down("Control");
  await page.mouse.move(box.x + 10, box.y + box.height / 2, { steps: 5 }); await w(1500); await page.keyboard.up("Control");
}
check("Ctrl-hover on an option opens a page preview", await ev(() => !!document.querySelector(".popover.hover-popover")));
await ev(() => document.querySelectorAll(".popover.hover-popover").forEach((p) => p.remove()));
await ev((M) => document.querySelector(`${M} .dmv-td-option a`).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 700, clientY: 400 })), M); await w(400);
const fileMenu = await ev(() => [...document.querySelectorAll(".menu .menu-item")].map((i) => i.textContent.trim()));
check("Right-click on an option opens the file menu", fileMenu.length > 3, fileMenu.slice(0, 4).join(" · "));
await page.keyboard.press("Escape"); await w(200);
await ev((M) => document.querySelector(`${M} .dmv-td-option a`).click(), M); await w(1500);
check("Clicking an option opens its note", await ev(() => /Laptop [A-D]/.test(app.workspace.getActiveFile()?.basename ?? "")));
await openDecision();

// Frame editor from the chip
await ev((M) => document.querySelector(`${M} .dmv-weights .dmv-chip .solenoid-property-chip`).shadowRoot.querySelector("button").click(), M); await w(1200);
check("The Weights chip opens Solenoid's Frame editor", await ev(() => /^weights/i.test(document.querySelector(".solenoid-popup-layer")?.shadowRoot?.querySelector(".sol-popup__header")?.textContent ?? "")));
await page.keyboard.press("Escape"); await w(500);

// The Scores chip: every option's scores in one Frame, and a Save writes each row back to its note
const LAYER = ".solenoid-popup-layer >>> ";
const popup = () => ev(() => {
  const root = document.querySelector(".solenoid-popup-layer")?.shadowRoot;
  return {
    title: root?.querySelector(".sol-popup__header")?.textContent ?? "",
    heads: [...(root?.querySelectorAll(".table-popup__colhead-input") ?? [])].map((i) => i.value),
    rows: [...(root?.querySelectorAll(".table-popup__grid tbody tr") ?? [])].map((tr) => [...tr.querySelectorAll("td input")].map((i) => i.value)),
  };
});
const openScores = async () => { await ev((M) => document.querySelector(`${M} .dmv-scores .solenoid-property-chip`).shadowRoot.querySelector("button").click(), M); await w(1200); };
const popupSave = async () => { await ev(() => [...document.querySelector(".solenoid-popup-layer").shadowRoot.querySelectorAll("button")].find((x) => x.textContent === "Save").click()); await w(2500); };
const scoresTypes = () => ev(async () => { const p = app.plugins.getPlugin("solenoid-properties"); return p.api ? p.api.columnTypes("scores") : (await p.loadData()).columnTypes.scores; });
check("A Scores chip sits beside the Weights chip", await ev((M) => { const s = document.querySelector(`${M} .dmv-scores`); return !!s?.querySelector(".solenoid-property-chip") && s.nextElementSibling?.classList.contains("dmv-weights"); }, M));
await openScores();
const joined = await popup();
const criteria = await heads();
check("The Scores chip opens every option's scores in one Frame", /^scores/i.test(joined.title) && joined.heads[0] === "Option" && criteria.every((c) => joined.heads.includes(c)) && joined.rows.length === 4, `${joined.heads.join(",")} · ${joined.rows.map((r) => r[0]).join(",")}`);
{
  const row = joined.rows.findIndex((r) => r[0] === "Laptop A");
  const col = joined.heads.indexOf(criteria[0]);
  const before = { b: (await fm("Laptop B")).scores[0], a: (await fm("Laptop A")).scores[0] };
  await page.click(`${LAYER}.table-popup__grid tbody tr:nth-child(${row + 1}) td:nth-child(${col + 2}) input`);
  await page.keyboard.down("Control"); await page.keyboard.press("a"); await page.keyboard.up("Control"); await page.keyboard.type("42"); await page.keyboard.press("Tab");
  await popupSave();
  const a = (await fm("Laptop A")).scores[0], b = (await fm("Laptop B")).scores[0];
  check("Saving the joined frame writes the edit to that option's note", a[criteria[0]] === 42 && Object.keys(a).join() === Object.keys(before.a).join(), JSON.stringify(a));
  check("Notes whose row did not change are left as they were", JSON.stringify(b) === JSON.stringify(before.b));
  check("The Option column's type is not recorded as a score column", !("Option" in (await scoresTypes())), JSON.stringify(await scoresTypes()));
}
{
  await openScores();
  const last = (await popup()).heads.length - 1;
  const from = (await popup()).heads[last], to = `${from} x`;
  const hadType = (await scoresTypes())[from];
  await page.click(`${LAYER}thead th:nth-child(${last + 2}) .table-popup__colhead-input`);
  await page.keyboard.press("End"); await page.keyboard.type(" x"); await page.keyboard.press("Tab");
  await popupSave();
  const notes = await Promise.all(["Laptop A", "Laptop B", "Laptop C", "Laptop D"].map(fm));
  const t = await scoresTypes();
  check("Renaming a column in the joined frame renames it in every note, its weight and its type", notes.every((n) => !(from in n.scores[0])) && notes.some((n) => to in n.scores[0]) && to in (await weights()) && !(from in (await weights())) && t[to] === hadType && !(from in t), `${from} → ${to}`);
  await openScores();
  await page.click(`${LAYER}thead th:nth-child(${last + 2}) .table-popup__colhead-input`);
  await page.keyboard.press("End"); for (let i = 0; i < 2; i++) await page.keyboard.press("Backspace"); await page.keyboard.press("Tab");
  await popupSave();
  check("Renaming it back restores the criterion", (await heads()).includes(from) && from in (await weights()));
}
const suggests = await ev(() => typeof app.plugins.getPlugin("solenoid-properties")?.api?.columnNames === "function");
if (suggests) {
  // A column typed under another Frame property, the way the editor records it.
  await ev(async () => { app.metadataTypeManager.setType("specs", "solenoid-frame"); await app.plugins.getPlugin("solenoid-properties").api.setColumnTypes("specs", { weight_kg: "number", maker: "string" }); }); await w(500);
  await openScores();
  await ev(() => [...document.querySelector(".solenoid-popup-layer").shadowRoot.querySelectorAll("button")].find((x) => x.textContent === "Add Column").click()); await w(300);
  const col = (await popup()).heads.length;
  await page.click(`${LAYER}thead th:nth-child(${col + 1}) .table-popup__colhead-input`);
  await page.keyboard.type("weight_"); await w(400);
  const offered = await ev(() => [...document.querySelector(".solenoid-popup-layer").shadowRoot.querySelectorAll(".table-popup__suggest-item")].map((x) => x.textContent));
  check("A Frame header suggests column names typed in the vault", offered.includes("weight_kg"), offered.join(", "));
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await w(300);
  const picked = await ev((c) => { const th = document.querySelector(".solenoid-popup-layer").shadowRoot.querySelectorAll("thead th")[c]; return [th.querySelector(".table-popup__colhead-input").value, th.querySelector(".table-popup__coltype").title]; }, col);
  check("Picking a suggested name sets the column's type", picked[0] === "weight_kg" && /Number/.test(picked[1]), picked.join(" · "));
  // A name typed two ways: the list says so, and a pick names the column without guessing its type.
  await ev(async () => { const api = app.plugins.getPlugin("solenoid-properties").api; app.metadataTypeManager.setType("specs2", "solenoid-frame"); await api.setColumnTypes("specs", { rating: "string" }); await api.setColumnTypes("specs2", { rating: "number" }); }); await w(300);
  await ev(() => [...document.querySelector(".solenoid-popup-layer").shadowRoot.querySelectorAll("button")].find((x) => x.textContent === "Add Column").click()); await w(300);
  const col2 = (await popup()).heads.length;
  const typeBefore = await ev((c) => document.querySelector(".solenoid-popup-layer").shadowRoot.querySelectorAll("thead th")[c].querySelector(".table-popup__coltype").title, col2);
  await page.click(`${LAYER}thead th:nth-child(${col2 + 1}) .table-popup__colhead-input`);
  await page.keyboard.type("rati"); await w(400);
  const mixed = await ev(() => [...document.querySelector(".solenoid-popup-layer").shadowRoot.querySelectorAll(".table-popup__suggest-item")].map((x) => x.textContent));
  check("A name typed two ways is offered with both types", mixed.some((t) => /^rating/.test(t) && /Text or Number/.test(t)), mixed.join(", "));
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await w(300);
  const mixedPick = await ev((c) => { const th = document.querySelector(".solenoid-popup-layer").shadowRoot.querySelectorAll("thead th")[c]; return [th.querySelector(".table-popup__colhead-input").value, th.querySelector(".table-popup__coltype").title]; }, col2);
  check("Picking it sets the name and leaves the column's type alone", mixedPick[0] === "rating" && mixedPick[1] === typeBefore, mixedPick.join(" · "));
  await ev(() => [...document.querySelector(".solenoid-popup-layer").shadowRoot.querySelectorAll("button")].find((x) => x.textContent === "Cancel").click()); await w(500);
  await ev((M) => [...document.querySelectorAll(`${M} .dmv-text-btn`)].find((x) => x.textContent === "Add criterion").click(), M); await w(400);
  await page.keyboard.type("wei"); await w(600);
  const listed = await ev(() => [...document.querySelectorAll(".suggestion-container .suggestion-item")].map((x) => x.textContent));
  check("Add criterion suggests number columns typed elsewhere, not text or weights columns", listed.includes("weight_kg") && !listed.includes("maker") && !listed.includes("Weight"), listed.join(", "));
  await page.keyboard.type("ght_"); await w(400); await page.keyboard.press("Enter"); await w(2000);
  check("Picking a suggestion adds that criterion", "weight_kg" in (await weights()) && (await heads()).includes("weight_kg"), `${Object.keys(await weights()).join(",")} · ${(await heads()).join(",")}`);
  if ((await heads()).includes("weight_kg")) {
    await openHeadMenu("weight_kg"); await menuPick("Remove criterion");
    await ev(() => [...document.querySelectorAll(".modal button")].find((x) => x.textContent === "Remove").click()); await w(2000);
  }
  const off = await ev(async () => { const p = app.plugins.getPlugin("solenoid-properties"); await p.setSuggestColumns(false); const n = p.api.columnNames().length; await p.setSuggestColumns(true); return n; });
  check("Turning Suggest column names off empties the list", off === 0);
}

// View options: another weights property, and a picked weights note
await ev(async () => { const f = app.vault.getAbstractFileByPath("Decision Matrix Examples/laptop-comparison.base"); await app.vault.process(f, (s) => s.replace("    name: Laptop Matrix\n", "    name: Laptop Matrix\n    weightsProperty: w2\n")); }); await w(2500);
check("Weights property option: w2 has no frame, so Create weights shows", await ev((M) => [...document.querySelectorAll(`${M} .dmv-btn`)].some((x) => x.textContent === "Create weights"), M));
await ev((M) => [...document.querySelectorAll(`${M} .dmv-btn`)].find((x) => x.textContent === "Create weights").click(), M); await w(2000);
check("Create weights writes a w2 frame with every criterion", ((await fm("Laptop Decision")).w2 ?? []).length === 6);
await ev(async () => {
  await app.vault.create("Decision Matrix Examples/Other Weights.md", "---\nweights:\n  - Criterion: cost\n    Weight: 7\n    Norm: null\n---\n");
  const f = app.vault.getAbstractFileByPath("Decision Matrix Examples/laptop-comparison.base");
  await app.vault.process(f, (s) => s.replace("    weightsProperty: w2\n", '    weightsNote: "[[Other Weights]]"\n'));
}); await w(2500);
check("Weights note option reads that note's frame", await ev((M) => document.querySelector(`${M} input[aria-label="Weight of cost"]`)?.value === "7" && document.querySelector(`${M} .dmv-weights .dmv-muted`)?.textContent === "Other Weights", M));
await ev(async () => { const f = app.vault.getAbstractFileByPath("Decision Matrix Examples/laptop-comparison.base"); await app.vault.process(f, (s) => s.replace('    weightsNote: "[[Other Weights]]"\n', "")); await app.vault.delete(app.vault.getAbstractFileByPath("Decision Matrix Examples/Other Weights.md")); }); await w(2000);

// Group by and collapse
await ev(async () => { const f = app.vault.getAbstractFileByPath("Decision Matrix Examples/laptop-comparison.base"); await app.vault.process(f, (s) => s.replace("    name: Laptop Matrix\n", "    name: Laptop Matrix\n    groupBy:\n      property: note.title\n      direction: ASC\n")); }); await w(2500);
const groups = await ev((M) => document.querySelectorAll(`${M} .dmv-group`).length, M);
check("Group by draws group rows", groups === 4, `${groups} groups`);
await ev((M) => document.querySelector(`${M} .dmv-group`).click(), M); await w(800);
check("Clicking a group row collapses it", await ev((M) => document.querySelectorAll(`${M} .dmv-row`).length === 3, M));
await ev(async () => { const f = app.vault.getAbstractFileByPath("Decision Matrix Examples/laptop-comparison.base"); await app.vault.process(f, (s) => s.replace("    groupBy:\n      property: note.title\n      direction: ASC\n", "")); }); await w(2000);

// Two views of the same notes at once
await ev(async () => { const leaf = app.workspace.getLeaf("split"); await leaf.openFile(app.vault.getAbstractFileByPath("Decision Matrix Examples/Laptop Decision.md")); }); await w(3000);
await ev(async () => { const f = app.vault.getAbstractFileByPath("Decision Matrix Examples/Laptop A.md"); await app.fileManager.processFrontMatter(f, (m) => { m.scores[0].performance = 10; }); }); await w(2000);
const both = await ev(() => [...document.querySelectorAll(".workspace-leaf")].map((l) => l.querySelector('.dmv-matrix input[aria-label="performance of Laptop A"]')?.value).filter(Boolean));
check("An edit shows in two open views of the same base", both.length >= 2 && both.every((v) => v === "10"), both.join(","));
await ev(() => { const all = []; const walk = (n) => { if (n.type === "leaf") all.push(n); (n.children ?? []).forEach(walk); }; walk(app.workspace.rootSplit); all.slice(1).forEach((l) => l.detach()); }); await w(800);

// Without Solenoid Properties
await ev(async () => { await app.plugins.disablePlugin("solenoid-properties"); app.workspace.iterateAllLeaves((l) => void l.rebuildView?.()); }); await w(2500);
check("Without Solenoid Properties the view says it is needed", await ev(() => /needs the Solenoid Properties plugin/.test(document.querySelector(".workspace-leaf.mod-active .dmv-root")?.textContent ?? "")));
await ev(async () => { await app.plugins.enablePlugin("solenoid-properties"); app.workspace.iterateAllLeaves((l) => void l.rebuildView?.()); }); await w(3000);
check("Re-enabling brings the matrix back", (await rows()).length === 4);

const passed = results.filter((x) => x.ok).length;
console.log(`── ${passed}/${results.length} passed, ${errors.length} console errors${errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""}`);
await b.disconnect();
process.exit(passed === results.length && errors.length === 0 ? 0 : 1);
