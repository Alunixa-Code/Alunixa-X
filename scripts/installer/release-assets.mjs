import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const repository = "Alunixa-Code/Alunixa-X";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

export function releaseVersion(tag) {
  assert.match(tag, /^[vV]\d+\.\d+\.\d+(?:[.-][0-9A-Za-z.-]+)?$/, "Invalid release tag");
  return tag.slice(1);
}

export function installationAssets(tag) {
  const version = releaseVersion(tag);
  return [
    `Alunixa-X-${version}-windows-x64-setup.exe`,
    `Alunixa-X-${version}-windows-x64.zip`,
    `Alunixa-X-${version}-macos-x64.dmg`,
    `Alunixa-X-${version}-macos-x64.zip`,
    `Alunixa-X-${version}-macos-arm64.dmg`,
    `Alunixa-X-${version}-macos-arm64.zip`,
  ];
}

function checkedNotes(tag, notesFile) {
  const notes = readFileSync(notesFile, "utf8").replace(/\r\n/g, "\n");
  const heading = notes.split("\n", 1)[0];
  const prefix = `# Alunixa X ${tag}`;
  assert(heading === prefix || heading.startsWith(`${prefix} `) || heading.startsWith(`${prefix}\t`),
    "Release notes must describe the exact AX tag");
  return notes;
}

export function inspectAssets(directory, tag) {
  const expected = installationAssets(tag);
  const actual = readdirSync(directory).filter((name) => name !== "latest.json").sort();
  assert.deepEqual(actual, [...expected].sort(), "Expected exactly six versioned installation assets");
  return expected.map((name) => {
    const path = resolve(directory, name);
    const stat = statSync(path);
    assert(stat.isFile() && stat.size > 0, `Missing or empty installation asset: ${name}`);
    return {
      name,
      url: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`,
      size: stat.size,
      sha256: createHash("sha256").update(readFileSync(path)).digest("hex"),
    };
  });
}

export function generateLatest(directory, tag, notesFile) {
  const payload = {
    version: tag,
    url: `https://github.com/${repository}/releases/tag/${tag}`,
    body: checkedNotes(tag, notesFile),
    assets: inspectAssets(directory, tag),
  };
  // Metadata hashes the six installation files, never itself.
  writeFileSync(resolve(directory, "latest.json"), `${JSON.stringify(payload, null, 2)}\n`);
  return payload;
}

export function verifyRelease(directory, tag) {
  const payload = JSON.parse(readFileSync(resolve(directory, "latest.json"), "utf8"));
  assert.equal(payload.version, tag);
  assert.equal(payload.url, `https://github.com/${repository}/releases/tag/${tag}`);
  assert.equal(typeof payload.body, "string");
  assert.deepEqual(payload.assets, inspectAssets(directory, tag), "Update metadata is stale or points at another repository");
  assert.equal(readdirSync(directory).length, 7, "Expected six installers and latest.json");
  return payload;
}

export function prepareNotes(directory, tag, notesFile, outputFile, env = process.env) {
  assert.equal(env.GITHUB_REPOSITORY, repository, "Wrong publishing repository");
  assert.match(env.GITHUB_RUN_ID ?? "", /^\d+$/, "Missing Actions run provenance");
  const payload = verifyRelease(directory, tag);
  const git = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" });
  assert.equal(git.status, 0, "Cannot resolve the source commit");
  let notes = checkedNotes(tag, notesFile);
  notes += `\n## 构建来源与文件校验\n\n- 代码提交：\`${git.stdout.trim()}\` 喵~\n`;
  notes += `- 正式 Actions：https://github.com/${repository}/actions/runs/${env.GITHUB_RUN_ID} 喵~\n`;
  if (env.REUSE_RUN_ID) {
    assert.match(env.REUSE_RUN_ID, /^\d+$/);
    notes += `- 同提交已验证的构建：https://github.com/${repository}/actions/runs/${env.REUSE_RUN_ID} 喵~\n`;
  }
  notes += "\n六项安装文件和一项更新元数据的 SHA-256，由本次工作流直接计算喵~\n\n```text\n";
  for (const asset of payload.assets) notes += `${asset.sha256}  ${asset.name}\n`;
  const metadataHash = createHash("sha256").update(readFileSync(resolve(directory, "latest.json"))).digest("hex");
  notes += `${metadataHash}  latest.json\n\`\`\`\n`;
  writeFileSync(outputFile, notes);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, tag = process.env.RELEASE_TAG, directory = "dist/release", notesFile = `docs/releases/${tag}.md`] = process.argv.slice(2);
  if (process.env.GITHUB_REPOSITORY) assert.equal(process.env.GITHUB_REPOSITORY, repository);
  if (command === "latest") {
    generateLatest(directory, tag, notesFile);
    verifyRelease(directory, tag);
  } else if (command === "verify") {
    verifyRelease(directory, tag);
  } else if (command === "notes") {
    assert(process.env.RUNNER_TEMP, "RUNNER_TEMP must be set");
    prepareNotes(directory, tag, notesFile, resolve(process.env.RUNNER_TEMP, "alunixa-x-release-notes.md"));
  } else {
    throw new Error("Usage: release-assets.mjs latest|verify|notes TAG [DIRECTORY] [NOTES_FILE]");
  }
  console.log(`AX ${tag}: ${command} verified (six installation assets + latest.json).`);
}
