"""Verify the native AX bundle and create a permission-preserving portable ZIP."""
import argparse
import os
from pathlib import Path
import plistlib
import stat
import struct
import time
import zipfile

SPECS = (
    ("Alunixa X.app", "io.github.alunixacode.alunixax", "AlunixaX", False),
    ("Alunixa X 管理工具.app", "io.github.alunixacode.alunixax.manager", "AlunixaXManager", True),
)
CPUS = {"x64": 0x01000007, "arm64": 0x0100000C}


def architectures(path):
    data = path.read_bytes()
    if len(data) < 8:
        raise ValueError(f"Truncated Mach-O: {path}")
    if data[:4] == b"\xcf\xfa\xed\xfe":
        return {struct.unpack_from("<I", data, 4)[0]}
    if data[:4] == b"\xfe\xed\xfa\xcf":
        return {struct.unpack_from(">I", data, 4)[0]}
    if data[:4] not in (b"\xca\xfe\xba\xbe", b"\xca\xfe\xba\xbf"):
        raise ValueError(f"Not Mach-O: {path}")
    count = struct.unpack_from(">I", data, 4)[0]
    stride = 32 if data[:4] == b"\xca\xfe\xba\xbf" else 20
    if not 0 < count <= 16 or len(data) < 8 + count * stride:
        raise ValueError(f"Invalid universal Mach-O header: {path}")
    return {struct.unpack_from(">I", data, 8 + index * stride)[0] for index in range(count)}


def verify(stage, arch, version=None, require_applications=False):
    expected_cpus = {CPUS[arch]} if arch in CPUS else set(CPUS.values())
    for name, bundle_id, executable, silent in SPECS:
        bundle = stage / name
        if bundle.is_symlink():
            raise ValueError(f"App must not be a symlink: {bundle}")
        with (bundle / "Contents/Info.plist").open("rb") as file:
            info = plistlib.load(file)
        expected = {
            "CFBundleIdentifier": bundle_id,
            "CFBundleExecutable": executable,
            "CFBundleName": name[:-4],
            "CFBundlePackageType": "APPL",
            "CodexPlusUnifiedApp": True,
            "LSUIElement": silent,
        }
        if version:
            expected.update(CFBundleVersion=version, CFBundleShortVersionString=version)
        for key, value in expected.items():
            if info.get(key) != value:
                raise ValueError(f"{name}: {key} must equal {value!r}")
        if (bundle / "Contents/PkgInfo").read_bytes() != b"APPL????":
            raise ValueError(f"Invalid PkgInfo: {name}")
        icon = bundle / "Contents/Resources" / info["CFBundleIconFile"]
        if not icon.is_file() or not icon.stat().st_size:
            raise ValueError(f"Missing AX icon: {name}")
        paths = [bundle / "Contents/MacOS" / executable]
        if not silent:
            display_name = info.get("CFBundleDisplayName", "")
            if "AX" not in display_name:
                raise ValueError("AX search alias is missing")
            schemes = {scheme for item in info.get("CFBundleURLTypes", []) for scheme in item.get("CFBundleURLSchemes", [])}
            if not {"codexplusplus", "dreamskin"} <= schemes:
                raise ValueError("Import URL protocols are missing")
            paths.append(bundle / "Contents/MacOS/alunixa-x-imagegen-mcp")
        for path in paths:
            if path.is_symlink() or not path.resolve().is_relative_to(bundle.resolve()):
                raise ValueError(f"Executable escapes bundle: {path}")
            if not expected_cpus <= architectures(path):
                raise ValueError(f"Wrong {arch} architecture: {path}")
            if os.name != "nt" and not os.access(path, os.X_OK):
                raise ValueError(f"Binary is not executable: {path}")
    if "Alunixa X 管理工具.app" not in (stage / ".hidden").read_text(encoding="utf-8").splitlines():
        raise ValueError("Legacy compatibility shim must be hidden")
    if require_applications:
        link = stage / "Applications"
        if not link.is_symlink() or os.readlink(link) != "/Applications":
            raise ValueError("DMG Applications target is missing")


def package_zip(stage, arch, version, output):
    verify(stage, arch, version)
    output.parent.mkdir(parents=True, exist_ok=True)
    entries = [stage / ".hidden"]
    for name, *_ in SPECS:
        entries.extend(sorted((stage / name).rglob("*")))
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for path in entries:
            if path.is_dir():
                continue
            if path.is_symlink():
                raise ValueError(f"Unexpected bundle symlink: {path}")
            relative = path.relative_to(stage).as_posix()
            info = zipfile.ZipInfo(f"app-{arch}/{relative}", time.localtime(max(path.stat().st_mtime, 315532800))[:6])
            info.create_system = 3
            executable = "/Contents/MacOS/" in f"/{relative}"
            info.external_attr = (stat.S_IFREG | (0o755 if executable else 0o644)) << 16
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, path.read_bytes())


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", type=Path)
    parser.add_argument("--arch", choices=(*CPUS, "universal"), required=True)
    parser.add_argument("--version")
    parser.add_argument("--require-applications", action="store_true")
    parser.add_argument("--zip", type=Path)
    args = parser.parse_args()
    verify(args.stage, args.arch, args.version, args.require_applications)
    if args.zip:
        if not args.version:
            parser.error("--zip requires --version")
        package_zip(args.stage, args.arch, args.version, args.zip)
    print(f"AX {args.arch}: native GUI, imagegen MCP and hidden legacy shim verified.")


if __name__ == "__main__":
    main()
