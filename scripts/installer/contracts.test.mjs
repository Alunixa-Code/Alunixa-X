import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { generateLatest, installationAssets, prepareNotes, releaseVersion, verifyRelease } from "./release-assets.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const text = (path) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");
const tag = "v1.0.36";
const bash = process.platform === "win32" ? "C:/Program Files/Git/bin/bash.exe" : "bash";
const python = process.platform === "win32" ? "python.exe" : "python3";
const hasPython = spawnSync(python, ["--version"], { encoding: "utf8" }).status === 0;
const hasBash = spawnSync(bash, ["--version"], { encoding: "utf8" }).status === 0;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: "utf8", ...options });
  assert.equal(result.status, 0, `${command}: ${result.error ?? ""}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function temporary(callback) {
  const directory = mkdtempSync(join(tmpdir(), "ax-installer-contract-"));
  try {
    return callback(directory);
  } finally {
    const target = realpathSync(directory);
    const parent = realpathSync(tmpdir());
    assert(target.startsWith(`${parent}\\`) || target.startsWith(`${parent}/`));
    assert(target !== parent && dirname(directory) === tmpdir());
    rmSync(directory, { recursive: true, force: true });
  }
}

function assetFixture(directory) {
  const notesFile = join(directory, "release.md");
  writeFileSync(notesFile, `# Alunixa X ${tag}\n\n统一 GUI 与安装修复。\n`);
  const assetDirectory = join(directory, "assets");
  mkdirSync(assetDirectory);
  for (const name of installationAssets(tag)) writeFileSync(join(assetDirectory, name), `fixture:${name}`);
  return { assetDirectory, notesFile };
}

test("six AX installation names are retained and invalid tags are rejected", () => {
  assert.equal(installationAssets(tag).length, 6);
  assert.equal(releaseVersion(tag), "1.0.36");
  assert.throws(() => releaseVersion("../../v1.0.36"));
  assert.throws(() => releaseVersion("v1.0.36\ninvalid"));
});

test("latest.json matches the core schema, owns all URLs, and carries exact hashes", () => temporary((directory) => {
  const { assetDirectory, notesFile } = assetFixture(directory);
  const payload = generateLatest(assetDirectory, tag, notesFile);
  assert.equal(payload.version, tag);
  assert.equal(typeof payload.body, "string");
  assert.equal(payload.assets.length, 6);
  assert(payload.assets.every(({ name, url, sha256, size }) =>
    url.endsWith(encodeURIComponent(name)) && url.startsWith("https://github.com/Alunixa-Code/Alunixa-X/") &&
    /^[a-f0-9]{64}$/.test(sha256) && size > 0));
  verifyRelease(assetDirectory, tag);
  writeFileSync(join(assetDirectory, payload.assets[0].name), "changed");
  assert.throws(() => verifyRelease(assetDirectory, tag), /stale|another repository/);
}));

test("metadata refuses extra installer assets and wrong-version release notes", () => temporary((directory) => {
  const { assetDirectory, notesFile } = assetFixture(directory);
  writeFileSync(notesFile, "# Alunixa X v1.0.35\n");
  assert.throws(() => generateLatest(assetDirectory, tag, notesFile), /exact AX tag/);
  writeFileSync(notesFile, "# Alunixa X v1.0.360\n");
  assert.throws(() => generateLatest(assetDirectory, tag, notesFile), /exact AX tag/);
  writeFileSync(notesFile, `# Alunixa X ${tag}\n`);
  writeFileSync(join(assetDirectory, "unexpected.dll"), "not shipped");
  assert.throws(() => generateLatest(assetDirectory, tag, notesFile), /six versioned/);
}));

test("detailed notes include all seven hashes without a metadata hash cycle", () => temporary((directory) => {
  const { assetDirectory, notesFile } = assetFixture(directory);
  generateLatest(assetDirectory, tag, notesFile);
  const output = join(directory, "release-notes.md");
  prepareNotes(assetDirectory, tag, notesFile, output, {
    GITHUB_REPOSITORY: "Alunixa-Code/Alunixa-X", GITHUB_RUN_ID: "123", REUSE_RUN_ID: "456",
  });
  const notes = readFileSync(output, "utf8");
  assert.equal((notes.match(/^[a-f0-9]{64}  /gm) ?? []).length, 7);
  assert(notes.includes("/actions/runs/123") && notes.includes("/actions/runs/456"));
  assert.throws(() => prepareNotes(assetDirectory, tag, notesFile, output, {
    GITHUB_REPOSITORY: "other/repository", GITHUB_RUN_ID: "123",
  }));
}));

test("all publication branches generate metadata and use unified Windows artifacts", () => {
  for (const file of [".github/workflows/pr-build.yml", ".github/workflows/release-assets.yml", ".github/workflows/release-recovery-self-hosted.yml"]) {
    const workflow = text(file);
    assert(workflow.includes("scripts/installer/windows/package.ps1"), file);
    assert(!workflow.includes("Copy-Item target/release/alunixa-x.exe"), file);
    assert(!workflow.includes("Copy-Item target/release/alunixa-x-manager.exe"), file);
    assert(!workflow.includes("Alunixa X Launch (AX).app"), file);
    assert(workflow.includes("macos-x64") || workflow.includes("arch: x64") || workflow.includes("@('x64', 'arm64')"), file);
    assert(workflow.includes("macos-arm64") || workflow.includes("arch: arm64") || workflow.includes("@('x64', 'arm64')"), file);
  }
  const release = text(".github/workflows/release-assets.yml");
  assert.equal((release.match(/release-assets\.mjs latest/g) ?? []).length, 2);
  assert(text(".github/workflows/release-recovery-self-hosted.yml").includes("release-assets.mjs latest"));
  assert(!release.includes("MACOS_CERTIFICATE") && !release.includes("MACOS_SIGNING_IDENTITY:"));
});

test("updater selection and Mac identity agree with the seven-asset AX contract", () => {
  const updater = text("crates/alunixa-x-core/src/update.rs");
  assert(updater.includes('"alunixa-x-"') && updater.includes('"alunixax_"'));
  assert(!updater.includes('name.contains("codex")') && !updater.includes('name.contains("plus")'));
  assert(updater.includes("https://github.com/Alunixa-Code/Alunixa-X/releases/latest/download/latest.json"));
  assert(updater.includes("https://api.github.com/repos/Alunixa-Code/Alunixa-X/releases/latest"));
  const mac = text("crates/alunixa-x-core/src/update/macos.rs");
  assert(mac.includes("id: crate::install::APP_BUNDLE_ID"));
  assert(mac.includes("id: crate::install::MANAGER_BUNDLE_ID"));
  assert(mac.includes("Alunixa X (AX).app") && mac.includes("Alunixa X Launch (AX).app"));
  assert(mac.includes("fn macos_update_preserves_v1035_bundles_during_success_and_rollback"));
});

test("NSIS keeps AX search, MCP, graceful process waits, and preserves previous binaries", () => {
  const script = text("scripts/installer/windows/AlunixaX.nsi");
  assert(script.includes("RequestExecutionLevel user"));
  assert(script.includes("AX - Alunixa X.lnk"));
  assert(script.includes('File "${APPDIR}\\alunixa-x-imagegen-mcp.exe"'));
  assert(script.includes('File "${APPDIR}\\alunixa-x-plus.exe"'));
  assert(script.includes("IDRETRY wait_retry IDCANCEL wait_cancel"));
  assert(!script.includes("taskkill") && !script.includes("RMDir /r"));
  const install = script.split('Section "Install"')[1].split("SectionEnd")[0];
  for (const old of ["alunixa-x.exe", "alunixa-x-manager.exe", "alunixa-x-plus-manager.exe"]) {
    assert(!install.includes(`Delete "$INSTDIR\\${old}"`));
  }
  assert(!script.includes("BigPizzaV3"));
});

for (const arch of ["x64", "arm64"]) test(`macOS ${arch} stage contains AX identities, import schemes, MCP and hidden shim`, { skip: !hasBash || !hasPython }, () => temporary((directory) => {
  const binaries = join(directory, "binaries");
  const stage = join(directory, "stage");
  mkdirSync(binaries);
  mkdirSync(stage);
  const macho = Buffer.alloc(2048);
  macho.writeUInt32LE(0xfeedfacf, 0);
  macho.writeUInt32LE(arch === "x64" ? 0x01000007 : 0x0100000C, 4);
  for (const binary of ["alunixa-x-plus", "alunixa-x-imagegen-mcp", "alunixa-x-legacy-shim"]) {
    writeFileSync(join(binaries, binary), macho, { mode: 0o755 });
  }
  const icon = join(directory, "icon.icns");
  writeFileSync(icon, "fixture AX icon");
  const forward = (value) => value.replaceAll("\\", "/");
  run(bash, ["--noprofile", "--norc", "-c", `
    source "$1"
    VERSION=1.0.36
    BINARY_DIR="$2"; STAGE="$3"; ICON_ICNS="$4"
    chflags() { :; }
    ${process.platform === "win32" ? `
    # MSYS cannot represent POSIX executability of a fixture Mach-O on NTFS.
    # Only that permission predicate is mocked; all production staging runs.
    [() {
      if builtin [ "$1" = "!" ] && builtin [ "$2" = "-x" ]; then
        builtin [ ! -f "$3" ]
      else
        builtin [ "$@"
      fi
    }
    ` : ""}
    stage_apps
  `, "contract", forward(join(root, "scripts/installer/macos/package-dmg.sh")), forward(binaries), forward(stage), forward(icon)]);
  const zip = join(directory, "macos.zip");
  run(python, ["scripts/installer/macos/verify-package.py", stage, "--arch", arch, "--version", "1.0.36", "--zip", zip]);
  run(python, ["scripts/installer/macos/verify-package.py", directory, "--arch", arch, "--version", "1.0.36", "--restore-executable-modes"]);
  run(python, ["-c", `
import sys, zipfile
with zipfile.ZipFile(sys.argv[1]) as z:
    executables=[n for n in z.namelist() if "/Contents/MacOS/" in n]
    assert len(executables)==3, executables
    assert all(((z.getinfo(n).external_attr >> 16) & 0o777)==0o755 for n in executables)
    assert f"app-{sys.argv[2]}/.hidden" in z.namelist()
`, zip, arch]);
  const wrongArch = spawnSync(python, ["scripts/installer/macos/verify-package.py", stage, "--arch", arch === "x64" ? "arm64" : "x64", "--version", "1.0.36"], { encoding: "utf8" });
  assert.notEqual(wrongArch.status, 0);
}));

test("all installer shell entry points parse with native Bash", { skip: !hasBash }, () => {
  for (const path of ["scripts/installer/macos/package-dmg.sh", "scripts/installer/macos/build-universal.sh", "scripts/installer/linux/build-deb.sh", "scripts/release/prepare-notes.sh"]) {
    run(bash, ["--noprofile", "--norc", "-n", path]);
  }
  const packager = text("scripts/installer/macos/package-dmg.sh");
  assert(packager.includes("prepare_background()") && packager.includes("detach_dmg()"));
  assert(packager.includes("-format UDRW") && packager.includes("-format UDZO"));
  assert(!packager.includes("pgrep -x") && !packager.includes("kill -KILL"));
  assert(!packager.includes("com.bigpizzav3"));
  assert(text("scripts/installer/macos/build-universal.sh").includes("alunixa-x-imagegen-mcp"));
});

const compiler = [process.env.NSIS_COMPILER, "C:/Program Files (x86)/NSIS/makensis.exe", "C:/Program Files/NSIS/makensis.exe"].find((path) => path && existsSync(path));
test("distributed packages preserve project and third-party license notices", () => {
  const windows = text("scripts/installer/windows/package.ps1");
  const nsis = text("scripts/installer/windows/AlunixaX.nsi");
  const macos = text("scripts/installer/macos/package-dmg.sh");
  const release = text(".github/workflows/release-assets.yml");
  for (const name of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    assert(windows.includes(`'${name}'`));
    assert(nsis.includes(`File "\${APPDIR}\\${name}"`));
    assert(macos.includes(`"$app_dir/Contents/Resources/${name}"`));
    assert(release.includes(`"$GITHUB_WORKSPACE/${name}"`));
  }
  assert(text("THIRD_PARTY_NOTICES.md").includes("Copyright (c) 2025 Jason Young"));
});
test("real NSIS packages fixture payloads without launching or installing them", { skip: process.platform !== "win32" || !compiler }, () => temporary((directory) => {
  const binaries = join(directory, "binaries");
  const output = join(directory, "packaged");
  mkdirSync(binaries);
  for (const name of ["alunixa-x-plus.exe", "alunixa-x-imagegen-mcp.exe"]) {
    const payload = Buffer.alloc(2048);
    payload.write("MZ");
    writeFileSync(join(binaries, name), payload);
  }
  const pwsh = spawnSync("pwsh.exe", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { encoding: "utf8" }).status === 0 ? "pwsh.exe" : "powershell.exe";
  run(pwsh, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(root, "scripts/installer/windows/package.ps1"),
    "-Version", "1.0.36", "-BinaryDir", binaries, "-OutputDir", output, "-Compiler", compiler]);
  const setup = join(output, "Alunixa-X-1.0.36-windows-x64-setup.exe");
  assert(readFileSync(setup).subarray(0, 2).equals(Buffer.from("MZ")));
  assert(existsSync(join(output, "Alunixa-X-1.0.36-windows-x64.zip")));
}));
