export function isClaudeModel(model: string): boolean {
  return model.toLowerCase().split(/[/:\\]/).some((part) => part.startsWith("claude-"));
}

export function supportsClaudeAdaptive(model: string, protocol: string, mode: string): boolean {
  return isClaudeModel(model)
    && (protocol === "chatCompletions" || protocol === "anthropicMessages")
    && mode !== "customModels" && mode !== "aggregate";
}
