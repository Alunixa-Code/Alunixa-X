import { ArrowDown, ArrowUp, GripVertical, Plus, TestTube, Trash2 } from "lucide-react";
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, arrayMove, useSortable, sortableKeyboardCoordinates, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { ReactNode } from "react";
import { modelProtocolKey } from "../model-protocols";
import { supportsClaudeAdaptive } from "../claude-thinking";
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

function SortableModel({ id, children }: { id: string; children: ReactNode }) {
  const { setNodeRef, transform, transition, attributes, listeners } = useSortable({ id });
  return <article ref={setNodeRef} className="custom-model-block" data-custom-model-id={id}
    style={{transform:CSS.Transform.toString(transform),transition}}>
    <button type="button" className="custom-model-drag" aria-label={t("拖动模型排序")} {...attributes} {...listeners}><GripVertical size={16}/></button>
    {children}
  </article>;
}

export function CustomModelsEditor({ models, defaultId, onChange, onTest, efforts = {}, onEffortChange }: {
  models: CustomModel[]; defaultId: string;
  onChange: (models: CustomModel[], defaultId: string) => void;
  onTest?: (model: CustomModel) => void;
  efforts?: Record<string, string>;
  onEffortChange?: (model: CustomModel, effort: string) => void;
}) {
  const sensors=useSensors(useSensor(PointerSensor,{activationConstraint:{delay:240,tolerance:6}}),
    useSensor(KeyboardSensor,{coordinateGetter:sortableKeyboardCoordinates}));
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
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={({active,over}) => {
      if (!over || active.id===over.id) return;
      const from=models.findIndex(model=>model.id===active.id),to=models.findIndex(model=>model.id===over.id);
      if(from>=0 && to>=0)onChange(arrayMove(models,from,to),defaultId);
    }}>
    <SortableContext items={models.map(model=>model.id)} strategy={verticalListSortingStrategy}>
    <div className="custom-model-blocks">
      {models.map((model,index) => <SortableModel id={model.id} key={model.id}>
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
          {onEffortChange ? <label className="field"><span>{t("模型最高思考等级")}</span>
            <select className="field-select" aria-label={t("模型最高思考等级")} value={efforts[modelProtocolKey(model.model)] || "xhigh"}
              onChange={event=>onEffortChange(model,event.currentTarget.value)}>
              {["low","medium","high","xhigh","max","ultra","adaptive"].map(effort=>
                <option key={effort} value={effort} disabled={effort==="adaptive" && !supportsClaudeAdaptive(model.model,model.protocol,"pureApi")}>
                  {effort==="adaptive"?t("自适应思维"):effort}
                </option>)}
            </select>
          </label> : null}
          <label className="field"><span>{t("自动压缩 Token 阈值")}</span>
            <Input aria-label={t("自动压缩 Token 阈值")} disabled={!model.autoCompactEnabled} value={model.autoCompactLimit}
              onChange={event => update(index,{autoCompactLimit:event.currentTarget.value})}/>
          </label>
          <label className="inline-toggle"><input type="checkbox" aria-label={t("自动压缩")} checked={model.autoCompactEnabled}
            onChange={event => update(index,{autoCompactEnabled:event.currentTarget.checked})}/><span>{t("自动压缩")}</span></label>
        </div>
      </SortableModel>)}
    </div>
    </SortableContext>
    </DndContext>
  </section>;
}
