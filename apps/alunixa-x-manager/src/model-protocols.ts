export type ModelProtocol =
  | "responses" | "chatCompletions" | "completions"
  | "anthropicMessages" | "geminiGenerateContent";

export function modelProtocolKey(model: string): string {
  return model.trim().replace(/\[\d+(?:\.\d+)?[KkMm]?\]$/, "").trim().toLowerCase();
}

export function parseModelProtocols(value?: string): Record<string, ModelProtocol> {
  if (!value?.trim()) return {};
  const parsed: unknown = JSON.parse(value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("modelProtocols must be a JSON object");
  }
  const map: Record<string, ModelProtocol> = Object.create(null);
  for (const [name, protocol] of Object.entries(parsed)) {
    if (!["responses", "chatCompletions", "completions", "anthropicMessages", "geminiGenerateContent"].includes(protocol)) {
      throw new Error("Unsupported model protocol");
    }
    const key = modelProtocolKey(name);
    if (!key) throw new Error("Empty model protocol key");
    map[key] = protocol;
  }
  return map;
}

export function hasModelProtocols(value?: string): boolean {
  // Invalid maps must not bypass the proxy and silently send the wrong protocol.
  try { return Object.keys(parseModelProtocols(value)).length > 0; }
  catch { return true; }
}

export function modelProtocolForName(value: string | undefined, model: string, fallback: string): string {
  try { return parseModelProtocols(value)[modelProtocolKey(model)] ?? fallback; }
  catch { return ""; }
}
