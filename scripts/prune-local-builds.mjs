#!/usr/bin/env node
// 清理 dist/ 下历史本地构建（dist/local-build-*），避免 Finder / Launchpad 里
// 堆积一排同名 Alunixa X 应用。
//
// 背景：每个本地构建副本都带独立的 bundle id，`open` 之后都会被 LaunchServices
// 注册成一个独立应用；构建一次多一个，久了就搜出一大排 Alunixa X。
// 约定（见 AGENTS.md「改完即构建启动」）：本地实例固定为 dist/local-build/Alunixa X.app，
// 不要再按任务名/时间戳新建目录。
//
// 本脚本默认只打印计划（dry-run）；加 --apply 才把旧构建移入废纸篓（可恢复），
// 不做 rm -rf，也不动固定目录和正在使用的构建。
//
// 用法：
//   node scripts/prune-local-builds.mjs                       # 预览
//   node scripts/prune-local-builds.mjs --apply               # 执行（移入废纸篓）
//   node scripts/prune-local-builds.mjs --apply --keep 1      # 额外保留最新 1 个旧构建
//   node scripts/prune-local-builds.mjs --apply --min-age-minutes 60
//
// 保护规则（永远不会被本脚本移走）：
//   1. dist/local-build（固定开发实例）
//   2. 有进程正在从该目录运行的构建
//   3. 最近 --min-age-minutes 分钟内改动过的构建（默认 30，避免打断刚完成的验证）
//   4. 目录里有 .keep 文件的构建
//   5. --keep N 指定的最新 N 个旧构建
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, renameSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const canonicalDir = path.join(distDir, "local-build");
const trashDir = path.join(process.env.HOME ?? "", ".Trash");
const lsregister =
  "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister";

const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log("用法: node scripts/prune-local-builds.mjs [--apply] [--keep N] [--min-age-minutes N]");
  process.exit(0);
}

const apply = args.includes("--apply");
const option = (name, fallback) => {
  const index = args.indexOf(name);
  const value = index >= 0 ? Number.parseInt(args[index + 1] ?? "", 10) : NaN;
  return Number.isFinite(value) ? value : fallback;
};
const keep = option("--keep", 0);
const minAgeMinutes = option("--min-age-minutes", 30);

const listBuildDirs = () => {
  if (!existsSync(distDir)) return [];
  return readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^local-build(-|$)/.test(entry.name))
    .map((entry) => path.join(distDir, entry.name));
};

// 目录及其一层子项的最新 mtime；只看两层足够判断“最近有没有被动过”。
const newestMtime = (dir) => {
  const statOf = (target) => {
    try {
      return statSync(target);
    } catch {
      return undefined;
    }
  };
  let newest = statOf(dir)?.mtimeMs ?? 0;
  let children = [];
  try {
    children = readdirSync(dir);
  } catch {
    return newest;
  }
  for (const name of children) {
    const child = path.join(dir, name);
    const stat = statOf(child);
    if (!stat) continue;
    newest = Math.max(newest, stat.mtimeMs);
    if (stat.isDirectory()) {
      try {
        for (const grandchild of readdirSync(child)) {
          const stat2 = statOf(path.join(child, grandchild));
          if (stat2) newest = Math.max(newest, stat2.mtimeMs);
        }
      } catch {
        // 忽略无权限的子目录
      }
    }
  }
  return newest;
};

// 哪些目录正被进程使用（app 的可执行文件路径里含该目录）。
const pathsInUse = () => {
  let commands = "";
  try {
    commands = execFileSync("ps", ["-axo", "command="], { encoding: "utf8" });
  } catch {
    return new Set();
  }
  return new Set(
    listBuildDirs().filter((dir) => commands.includes(`${dir}/`) || commands.includes(`${dir} `)),
  );
};

const dirSizeKb = (dir) => {
  try {
    const output = execFileSync("du", ["-sk", dir], { encoding: "utf8" });
    const kb = Number.parseInt(output.trim().split(/\s+/)[0] ?? "", 10);
    return Number.isFinite(kb) ? kb : 0;
  } catch {
    return 0;
  }
};

const formatSize = (kb) => {
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`;
  if (kb >= 1024) return `${(kb / 1024).toFixed(0)} MB`;
  return `${kb} KB`;
};

// 移入废纸篓前先从 LaunchServices 注销，避免 Finder/Spotlight 里残留幽灵条目。
const unregisterApps = (dir) => {
  let names = [];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".app")) continue;
    try {
      execFileSync(lsregister, ["-u", path.join(dir, name)], { stdio: "ignore" });
    } catch {
      // 没注册过或已失效都无所谓
    }
  }
};

const trashPath = (dir) => {
  const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const base = path.join(trashDir, `${path.basename(dir)}-${stamp}`);
  let candidate = base;
  let suffix = 1;
  while (existsSync(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  return candidate;
};

const dirs = listBuildDirs();
const inUse = pathsInUse();
const now = Date.now();
const ageLimit = minAgeMinutes * 60 * 1000;

const entries = dirs.map((dir) => ({
  dir,
  name: path.basename(dir),
  canonical: dir === canonicalDir,
  inUse: inUse.has(dir),
  fresh: now - newestMtime(dir) < ageLimit,
  keepMarker: existsSync(path.join(dir, ".keep")),
  mtime: newestMtime(dir),
}));

if (!entries.length) {
  console.log("dist/ 下没有 local-build* 目录，无需清理。");
  process.exit(0);
}

const protectedEntries = entries.filter((entry) => entry.canonical || entry.inUse || entry.fresh || entry.keepMarker);
const candidates = entries
  .filter((entry) => !protectedEntries.includes(entry))
  .sort((left, right) => right.mtime - left.mtime);
const keptByCount = candidates.slice(0, keep);
const removable = candidates.slice(keep);

const reasonFor = (entry) => {
  if (entry.canonical) return "固定开发实例";
  if (entry.inUse) return "有进程正在使用";
  if (entry.fresh) return `最近 ${minAgeMinutes} 分钟内改动过`;
  if (entry.keepMarker) return "有 .keep 标记";
  if (keptByCount.includes(entry)) return `--keep ${keep} 保留`;
  return "历史构建";
};

console.log(`本地构建目录: ${distDir}`);
for (const entry of protectedEntries.concat(keptByCount)) {
  console.log(`  保留  ${entry.name}（${reasonFor(entry)}）`);
}

if (!removable.length) {
  console.log("\n没有需要清理的历史构建。");
  process.exit(0);
}

const totalKb = removable.reduce((sum, entry) => sum + dirSizeKb(entry.dir), 0);
console.log(`\n待移入废纸篓: ${removable.length} 个目录，共约 ${formatSize(totalKb)}${apply ? "" : "（预览，加 --apply 执行）"}`);
for (const entry of removable) {
  console.log(`  - ${entry.name}（${formatSize(dirSizeKb(entry.dir))}）`);
}

if (!apply) {
  console.log("\n[dry-run] 未做任何改动。确认无误后加 --apply。");
  process.exit(0);
}

let moved = 0;
for (const entry of removable) {
  const destination = trashPath(entry.dir);
  unregisterApps(entry.dir);
  renameSync(entry.dir, destination);
  console.log(`  已移入废纸篓: ${entry.name} -> ${destination}`);
  moved += 1;
}
console.log(`\n已移入废纸篓 ${moved} 个历史构建。清空废纸篓后可释放约 ${formatSize(totalKb)}。`);
console.log("固定实例仍是 dist/local-build/Alunixa X.app，下次构建直接原地替换即可。");
