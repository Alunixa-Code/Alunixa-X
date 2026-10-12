import { modelProtocolKey } from "./model-protocols.ts";

export type CustomModelIssue = "empty" | "name" | "duplicate" | "url" | "protocol" | "window" | "compression";
type Draft = { model: string; baseUrl: string; protocol: string; contextWindow: string; autoCompactEnabled: boolean; autoCompactLimit: string };

function tokens(value: string): number | null {
  const match=/^(\d+(?:\.\d+)?)\s*([KM])?$/i.exec(value.trim());
  if(!match)return null;
  const number=Number(match[1])*(match[2]?.toLowerCase()==="m"?1_000_000:match[2]?.toLowerCase()==="k"?1_000:1);
  return Number.isSafeInteger(number) && number>0?number:null;
}

export function customModelsValidationIssue(models: readonly Draft[], inheritedBaseUrl = ""): CustomModelIssue | null {
  if(!models.length)return "empty";
  const names=new Set<string>();
  for(const model of models) {
    const name=modelProtocolKey(model.model);
    if(!name)return "name";
    if(names.has(name))return "duplicate";
    names.add(name);
    try {
      const url=new URL(model.baseUrl.trim() || inheritedBaseUrl.trim());
      if(!["http:","https:"].includes(url.protocol) || url.username || url.password)return "url";
    } catch {return "url";}
    if(!["responses","chatCompletions","completions","anthropicMessages","geminiGenerateContent"].includes(model.protocol))return "protocol";
    const window=model.contextWindow.trim()?tokens(model.contextWindow):null;
    if(model.contextWindow.trim() && !window)return "window";
    if(model.autoCompactEnabled) {
      const limit=tokens(model.autoCompactLimit);
      if(!limit || (window && limit>=window))return "compression";
    }
  }
  return null;
}
