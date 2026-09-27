// Read-only product mapping. Outputs candidates in an ignored workspace; never overwrites sources.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
const base = "refs/remotes/upstream/v1.2.48";
const target = "refs/remotes/upstream/v1.3.0";
const root = process.cwd();
const output = path.join(root, ".tmp", "upstream-1.3.0");
fs.mkdirSync(output, { recursive: true });
const git = (...args) => {
  const p = spawnSync("git", args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (p.status) throw new Error(`git ${args[0]} failed`);
  return p.stdout;
};
const mapPath = p => p.replaceAll("codex-plus", "alunixa-x").replace("CodexPlusPlus.nsi", "AlunixaX.nsi");
const mapText = (p, text) => {
  if (p.startsWith("assets/inject/upstream/")) return text.replaceAll("\r\n", "\n");
  return text.replaceAll("\r\n", "\n")
    .replaceAll("codex-plus", "alunixa-x").replaceAll("codex_plus", "alunixa_x")
    .replaceAll("CODEX_PLUS", "ALUNIXA_X").replaceAll("CodexPlusPlus", "AlunixaX")
    .replaceAll("codexPlus", "alunixaX").replaceAll("CodexPlus", "AlunixaX")
    .replaceAll("Codex++", "Alunixa X");
};
const rows = [];
const names = git("diff", "--name-only", base, target).trim().split("\n");
for (const source of names) {
  const dest = mapPath(source);
  const status = { source, dest };
  if (/\/ads\.rs$|sponsor|^AGENTS\.md$/.test(source)) { rows.push({ ...status, status: "excluded" }); continue; }
  if (!/^(apps\/|crates\/|assets\/inject\/|assets\/.*metadata|scripts\/installer\/)/.test(source)) {
    rows.push({ ...status, status: "manual_metadata" }); continue;
  }
  const existsAt = ref => spawnSync("git", ["cat-file", "-e", `${ref}:${source}`], { cwd: root }).status === 0;
  if (!existsAt(target)) { rows.push({ ...status, status: "upstream_deleted" }); continue; }
  const theirs = mapText(source, git("show", `${target}:${source}`));
  const before = existsAt(base) ? mapText(source, git("show", `${base}:${source}`)) : "";
  const local = fs.existsSync(dest) ? fs.readFileSync(dest, "utf8").replaceAll("\r\n", "\n") : "";
  if (theirs === local) { rows.push({ ...status, status: "identical" }); continue; }
  const dir = path.join(output, dest);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  if (local === before || !local) {
    fs.writeFileSync(dir, theirs);
    rows.push({ ...status, status: local ? "clean_update" : "new" }); continue;
  }
  fs.writeFileSync(dir + ".ours", local);
  fs.writeFileSync(dir + ".base", before);
  fs.writeFileSync(dir + ".theirs", theirs);
  const merged = spawnSync("git", ["merge-file", "-p", "--diff3", dir + ".ours", dir + ".base", dir + ".theirs"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (merged.status < 0 || merged.status > 127) throw new Error("merge-file failed");
  fs.writeFileSync(dir, merged.stdout);
  rows.push({ ...status, status: merged.status ? "conflict" : "clean_merge", conflicts: merged.status });
}
fs.writeFileSync(path.join(output, "manifest.json"), JSON.stringify({ base, target, rows }, null, 2) + "\n");
console.log(JSON.stringify(rows.reduce((counts, row) => ({ ...counts, [row.status]: (counts[row.status] || 0) + 1 }), {})));
console.log(rows.filter(r => r.status === "conflict").map(r => `${r.conflicts} ${r.dest}`).join("\n"));
