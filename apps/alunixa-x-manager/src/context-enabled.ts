// Only root scalar flags belong to the MCP/plugin entry, not its env or settings tables.
function rootFlagLines(body: string): Array<{ text: string; flag: string; value: boolean }> {
  let quote = "";
  let depth = 0;
  let root = true;
  return body.split(/(?<=\n)/).map((text) => {
    const trimmed = text.trim();
    if (!quote && depth === 0 && /^\[/.test(trimmed)) root = false;
    const match = root && !quote && depth === 0
      ? /^(["']?)(enabled|disabled)\1\s*=\s*(true|false)\s*(?:#.*)?$/.exec(trimmed) : null;
    for (let index = 0; index < text.length; index++) {
      const char = text[index];
      if (quote) {
        if ((quote === '"' || quote === '"""') && char === "\\") {
          index++;
        } else if (text.startsWith(quote, index)) {
          index += quote.length - 1;
          quote = "";
        }
        continue;
      }
      if (char === "#") break;
      if (char === '"' || char === "'") {
        quote = text.startsWith(char.repeat(3), index) ? char.repeat(3) : char;
        index += quote.length - 1;
      } else if (char === "[" || char === "{") {
        depth++;
      } else if (char === "]" || char === "}") {
        depth = Math.max(0, depth - 1);
      }
    }
    return { text, flag: match?.[2] ?? "", value: match?.[3] === "true" };
  });
}

export function contextRootEnabled(body: string): boolean {
  const flags = rootFlagLines(body);
  const legacy = flags.filter((line) => line.flag === "disabled").pop();
  const flag = flags.filter((line) => line.flag === "enabled").pop();
  return !legacy?.value && (!flag || flag.value);
}

export function setContextRootEnabled(body: string, enabled: boolean): string {
  const retained = rootFlagLines(body).filter((line) => !line.flag).map((line) => line.text).join("");
  return `enabled = ${enabled}\n${retained}`;
}
