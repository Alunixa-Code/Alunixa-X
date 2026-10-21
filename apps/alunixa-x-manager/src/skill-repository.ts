import { isGitHubRepositoryHomepage } from "./github-repository.ts";

export type SkillRepository = { owner: string; name: string; branch: string; subdir: string; enabled: boolean };

export function parseSkillRepository(value: string): SkillRepository | null {
  try {
    const input = value.trim().replace(/^git\+/, "");
    const url = new URL(input.includes("://") ? input : `https://github.com/${input}`);
    if (!["https:", "http:"].includes(url.protocol) || !["github.com", "www.github.com"].includes(url.hostname) || url.username || url.password || url.port) return null;
    const parts = url.pathname.replace(/\/+$/, "").split("/").slice(1).map(decodeURIComponent);
    const [owner, rawName, marker, branch, ...subdir] = parts;
    const name = rawName?.replace(/\.git$/, "");
    if (!owner || !name || !isGitHubRepositoryHomepage(`https://github.com/${owner}/${name}`)) return null;
    if (parts.length > 2 && (marker !== "tree" || !branch)) return null;
    if (subdir.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) return null;
    return { owner, name, branch: branch || "main", subdir: subdir.join("/"), enabled: true };
  } catch {
    return null;
  }
}
