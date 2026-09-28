// A private Obsidian for end-to-end tests: its own Xvfb display, profile and vault (under the system temp
// folder), with Solenoid Properties (the Solenoid look on) and this repo's build. Linux, needs Xvfb.
//   SP=<a Solenoid Properties build folder> [OBSIDIAN=<binary>] node scripts/e2e/rig.mjs <command>
//     up              start it (idempotent)
//     reset [light]   fresh examples, one pane, the decision note open
//     sp <folder>     swap in another Solenoid Properties build and reload
//     eval '<js>'     run JS in the app window (`app` in scope) and print the result
//     shot <out.png> [x,y,w,h]
//     run             up, reset, then fulltest.mjs and legacy.mjs; exits non-zero on any failure
//     down
// `npm run build` first; `npm run e2e` is `run`.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const RIG = path.join(os.tmpdir(), "decision-matrix-e2e");
const VAULT = path.join(RIG, "vault");
const PROFILE = path.join(RIG, "profile");
const DISPLAY = process.env.RIG_DISPLAY ?? ":7";
const PORT = Number(process.env.RIG_PORT ?? 9333);
const OBSIDIAN = process.env.OBSIDIAN ?? "/opt/Obsidian/obsidian";
const SP = process.env.SP;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const answers = async () => { try { return (await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok; } catch { return false; } };

function copyPlugins(sp = SP) {
  if (!sp) throw new Error("rig: set SP to a Solenoid Properties build folder (main.js, manifest.json, styles.css)");
  const plugins = path.join(VAULT, ".obsidian", "plugins");
  fs.cpSync(sp, path.join(plugins, "solenoid-properties"), { recursive: true, force: true });
  const dm = path.join(plugins, "decision-matrix-bases-view");
  fs.mkdirSync(dm, { recursive: true });
  for (const f of ["main.js", "manifest.json", "styles.css"]) fs.copyFileSync(path.join(REPO, f), path.join(dm, f));
}

async function withApp(fn) {
  const browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null });
  try {
    const page = (await browser.pages()).find((p) => p.url().startsWith("app://"));
    await page.waitForFunction(() => !!window.app?.workspace?.layoutReady, { timeout: 30000 });
    return await fn(page, browser);
  } finally { await browser.disconnect(); }
}

async function up() {
  if (await answers()) return;
  fs.rmSync(VAULT, { recursive: true, force: true });
  fs.mkdirSync(path.join(VAULT, ".obsidian", "plugins", "solenoid-properties"), { recursive: true });
  fs.writeFileSync(path.join(VAULT, ".obsidian", "community-plugins.json"), JSON.stringify(["solenoid-properties", "decision-matrix-bases-view"]));
  fs.writeFileSync(path.join(VAULT, ".obsidian", "plugins", "solenoid-properties", "data.json"), JSON.stringify({ look: true, palette: "Default", accent: "gold" }));
  fs.writeFileSync(path.join(VAULT, "Welcome.md"), "# Rig\n");
  copyPlugins();
  fs.mkdirSync(PROFILE, { recursive: true });
  fs.writeFileSync(path.join(PROFILE, "obsidian.json"), JSON.stringify({ vaults: { d3c1e2e0a1b2c3d4: { path: VAULT, ts: Date.now(), open: true } } }));
  spawn("Xvfb", [DISPLAY, "-screen", "0", "1500x950x24", "-nolisten", "tcp"], { detached: true, stdio: "ignore" }).unref();
  await sleep(1000);
  spawn(OBSIDIAN, ["--no-sandbox", `--user-data-dir=${PROFILE}`, `--remote-debugging-port=${PORT}`], { detached: true, stdio: "ignore", env: { ...process.env, DISPLAY } }).unref();
  for (let i = 0; i < 80 && !(await answers()); i++) await sleep(500);
  if (!(await answers())) throw new Error("rig: Obsidian never answered");
  await withApp((page) => page.evaluate(async () => {
    // A vault opened for the first time asks whether to trust its author, and the dialog comes late:
    // left open, it takes the keyboard from the tests.
    for (let i = 0; i < 40; i++) {
      const trust = [...document.querySelectorAll(".modal-container button")].find((b) => /trust/i.test(b.textContent ?? ""));
      if (trust) { trust.click(); break; }
      await new Promise((r) => setTimeout(r, 250));
    }
    const { plugins } = window.app;
    if (!plugins.isEnabled?.() && plugins.setEnable) await plugins.setEnable(true);
    for (const id of ["solenoid-properties", "decision-matrix-bases-view"]) if (!plugins.enabledPlugins.has(id)) await plugins.enablePluginAndSave(id);
    document.querySelectorAll(".modal-container .modal-close-button").forEach((x) => x.click());
    try { window.electron.remote.getCurrentWindow().setBounds({ x: 0, y: 0, width: 1500, height: 950 }); } catch { /* keeps its size */ }
  }));
}

async function reload() {
  await withApp((page) => page.evaluate(async () => {
    const { plugins } = window.app;
    await plugins.disablePlugin("decision-matrix-bases-view");
    await plugins.disablePlugin("solenoid-properties");
    await plugins.enablePlugin("solenoid-properties");
    await plugins.enablePlugin("decision-matrix-bases-view");
  }));
}

async function reset(theme) {
  await withApp((page) => page.evaluate(async (theme) => {
    const w = (ms) => new Promise((r) => setTimeout(r, ms));
    for (const p of ["Decision Matrix Examples", "Legacy"]) { const f = app.vault.getAbstractFileByPath(p); if (f) await app.vault.delete(f, true); }
    app.setting.open(); app.setting.openTabById("decision-matrix-bases-view"); await w(1000);
    [...app.setting.activeTab.containerEl.querySelectorAll("button")].find((b) => /Create examples/i.test(b.textContent)).click(); await w(1500);
    app.setting.close();
    app.workspace.rightSplit.collapse();
    const leaves = []; const walk = (n) => { if (n.type === "leaf") leaves.push(n); (n.children ?? []).forEach(walk); }; walk(app.workspace.rootSplit);
    leaves.slice(1).forEach((l) => l.detach());
    app.changeTheme(theme === "light" ? "moonstone" : "obsidian");
    await app.workspace.getLeaf(false).openFile(app.vault.getAbstractFileByPath("Decision Matrix Examples/Laptop Decision.md"));
    await w(2500);
  }, theme));
}

async function evaluate(js) {
  const r = await withApp((page) => page.evaluate((src) => {
    const app = window.app;
    return Promise.resolve(eval(src)).then((v) => (v === undefined ? null : JSON.parse(JSON.stringify(v))));
  }, js));
  console.log(JSON.stringify(r, null, 1));
}

async function shot(out, clip) {
  await withApp(async (page) => {
    const c = clip ? (([x, y, width, height]) => ({ x, y, width, height }))(clip.split(",").map(Number)) : undefined;
    await page.screenshot({ path: path.resolve(out), clip: c });
  });
}

function node(script, ...args) {
  return spawnSync(process.execPath, [path.join(HERE, script), ...args], { stdio: "inherit" }).status === 0;
}

async function run() {
  await up();
  copyPlugins();
  await reload();
  await reset();
  const full = node("fulltest.mjs");
  const legacy = node("legacy.mjs");
  process.exit(full && legacy ? 0 : 1);
}

function down() {
  spawnSync("pkill", ["-f", `[u]ser-data-dir=${PROFILE}`]);
  spawnSync("pkill", ["-f", `[X]vfb ${DISPLAY}`]);
}

const [cmd, ...rest] = process.argv.slice(2);
const commands = {
  up, down, run,
  reset: () => reset(rest[0]),
  sp: async () => { copyPlugins(path.resolve(rest[0])); await reload(); },
  eval: () => evaluate(rest.join(" ")),
  shot: () => shot(rest[0], rest[1]),
};
if (!commands[cmd]) { console.error("usage: rig.mjs up | reset [light] | sp <folder> | eval '<js>' | shot <out.png> [x,y,w,h] | run | down"); process.exit(1); }
await commands[cmd]();
