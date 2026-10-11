import { Plus, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { t } from "../i18n";

export type CustomModel = {
  id: string; model: string; baseUrl: string; apiKey: string;
  protocol: string; contextWindow: string; autoCompactEnabled: boolean; autoCompactLimit: string;
};

export function CustomModelsEditor({ models, defaultId, onChange }: {
  models: CustomModel[]; defaultId: string;
  onChange: (models: CustomModel[], defaultId: string) => void;
}) {
  const update = (index: number, patch: Partial<CustomModel>) =>
    onChange(models.map((model, i) => i === index ? {...model,...patch} : model), defaultId);
  return <section className="relay-config-section">
    <div className="relay-config-section-head"><strong>{t("按模型独立配置 Base URL、Key 与协议")}</strong>
      <Button onClick={() => {
        const model: CustomModel = {id: crypto.randomUUID(), model:"", baseUrl:"", apiKey:"", protocol:"responses", contextWindow:"", autoCompactEnabled:false, autoCompactLimit:""};
        onChange([...models,model], defaultId || model.id);
      }}><Plus size={16}/>{t("添加模型")}</Button>
    </div>
    {models.map((model,index) => <div className="relay-custom-model" key={model.id}>
      <label><input type="radio" checked={defaultId === model.id} onChange={() => onChange(models,model.id)}/>{t("默认")}</label>
      <Input aria-label={t("模型名称")} value={model.model} onChange={event => update(index,{model:event.currentTarget.value})}/>
      <Input aria-label="Base URL" value={model.baseUrl} onChange={event => update(index,{baseUrl:event.currentTarget.value})}/>
      <Input aria-label="API Key" type="password" value={model.apiKey} onChange={event => update(index,{apiKey:event.currentTarget.value})}/>
      <select aria-label={t("模型协议")} value={model.protocol} onChange={event => update(index,{protocol:event.currentTarget.value})}>
        {["responses","chatCompletions","completions","anthropicMessages","geminiGenerateContent"].map(protocol => <option key={protocol} value={protocol}>{protocol}</option>)}
      </select>
      <Input aria-label={t("上下文窗口")} value={model.contextWindow} onChange={event => update(index,{contextWindow:event.currentTarget.value})}/>
      <Button size="icon" aria-label={t("删除模型")} onClick={() => {
        const next=models.filter((_, i) => i !== index);
        onChange(next, defaultId === model.id ? next[0]?.id ?? "" : defaultId);
      }}><Trash2 size={16}/></Button>
    </div>)}
  </section>;
}
