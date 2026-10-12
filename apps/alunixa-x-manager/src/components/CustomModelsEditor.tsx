import { ArrowDown, ArrowUp, Plus, TestTube, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { t } from "../i18n";

export type CustomModel = {
  id: string; model: string; baseUrl: string; apiKey: string;
  protocol: string; contextWindow: string; autoCompactEnabled: boolean; autoCompactLimit: string;
  autoCompactPercent?: number;
};

export function createEmptyCustomModel(): CustomModel {
  return { id: crypto.randomUUID(), model: "", baseUrl: "", apiKey: "", protocol: "responses",
    contextWindow: "", autoCompactEnabled: false, autoCompactLimit: "" };
}

const protocols = [
  ["responses", "Responses API"], ["chatCompletions", "Chat Completions"],
  ["completions", "Completions"], ["anthropicMessages", "Anthropic Messages"],
  ["geminiGenerateContent", "Gemini Generate Content"],
] as const;

export function CustomModelsEditor({ models, defaultId, onChange, onTest }: {
  models: CustomModel[]; defaultId: string;
  onChange: (models: CustomModel[], defaultId: string) => void;
  onTest?: (model: CustomModel) => void;
}) {
  const update = (index: number, patch: Partial<CustomModel>) =>
    onChange(models.map((model, i) => i === index ? {...model,...patch} : model), defaultId);
  const move = (index: number, direction: -1 | 1) => {
    const next = [...models];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next, defaultId);
  };
  return <section className="relay-config-section">
    <div className="relay-config-section-head"><strong>{t("按模型独立配置 Base URL、Key 与协议")}</strong>
      <Button onClick={() => {
        const model = createEmptyCustomModel();
        onChange([...models,model], defaultId || model.id);
      }}><Plus size={16}/>{t("添加模型")}</Button>
    </div>
    <p className="field-hint">{t("多模型模式不再写根级窗口覆盖；Codex 会从模型目录读取每个模型自己的上下文窗口与压缩阈值，切换模型后立即使用对应值。")}</p>
    <div className="custom-model-blocks">
      {models.map((model,index) => <article className="custom-model-block" key={model.id} data-custom-model-id={model.id}>
        <header className="custom-model-block-head">
          <label className="inline-toggle">
            <input type="radio" name="default-custom-model" checked={defaultId === model.id}
              aria-label={t("启动模型")} onChange={() => onChange(models,model.id)}/>
            <span>{t("默认")} · {model.model || t("未命名模型")}</span>
          </label>
          <div className="custom-model-block-actions">
            <Button size="icon" variant="ghost" aria-label={t("上移模型")} disabled={index === 0}
              onClick={() => move(index,-1)}><ArrowUp size={16}/></Button>
            <Button size="icon" variant="ghost" aria-label={t("下移模型")} disabled={index === models.length-1}
              onClick={() => move(index,1)}><ArrowDown size={16}/></Button>
            {onTest ? <Button size="icon" variant="ghost" aria-label={t("测试模型")}
              disabled={!model.model.trim() || !model.baseUrl.trim()} onClick={() => onTest(model)}><TestTube size={16}/></Button> : null}
            <Button size="icon" variant="ghost" aria-label={t("删除模型")} onClick={() => {
              const next=models.filter((_, i) => i !== index);
              onChange(next, defaultId === model.id ? next[0]?.id ?? "" : defaultId);
            }}><Trash2 size={16}/></Button>
          </div>
        </header>
        <div className="relay-options-grid custom-model-fields">
          <label className="field"><span>{t("模型名称")}</span>
            <Input aria-label={t("模型名称")} value={model.model} onChange={event => update(index,{model:event.currentTarget.value})}/>
          </label>
          <label className="field"><span>Base URL</span>
            <Input aria-label="Base URL" value={model.baseUrl} onChange={event => update(index,{baseUrl:event.currentTarget.value})}/>
          </label>
          <label className="field"><span>API Key</span>
            <Input aria-label="API Key" autoComplete="off" type="password" value={model.apiKey} onChange={event => update(index,{apiKey:event.currentTarget.value})}/>
          </label>
          <label className="field"><span>{t("模型协议")}</span>
            <select className="field-select" aria-label={t("模型协议")} value={model.protocol}
              onChange={event => update(index,{protocol:event.currentTarget.value})}>
              {protocols.map(([protocol,label]) => <option key={protocol} value={protocol}>{label}</option>)}
            </select>
          </label>
          <label className="field"><span>{t("上下文窗口")}</span>
            <Input aria-label={t("上下文窗口")} placeholder="200000 / 1M" value={model.contextWindow}
              onChange={event => update(index,{contextWindow:event.currentTarget.value})}/>
          </label>
          <label className="field"><span>{t("自动压缩 Token 阈值")}</span>
            <Input aria-label={t("自动压缩 Token 阈值")} disabled={!model.autoCompactEnabled} value={model.autoCompactLimit}
              onChange={event => update(index,{autoCompactLimit:event.currentTarget.value})}/>
          </label>
          <label className="inline-toggle"><input type="checkbox" aria-label={t("自动压缩")} checked={model.autoCompactEnabled}
            onChange={event => update(index,{autoCompactEnabled:event.currentTarget.checked})}/><span>{t("自动压缩")}</span></label>
        </div>
      </article>)}
    </div>
  </section>;
}
