import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, Check, GripVertical, ImagePlus, Pencil, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { t, tf } from "../i18n";
import { imageModelEdits, reorderImageModels, upsertImageModel, validateImageModel,
  type ImageModelDraft, type ImageModelEdit, type ImageModelSummary, type ImageModelsSnapshot } from "../image-models";

export function ImageModelsScreen({ onPendingChange }: {
  onPendingChange: (state: { busy: boolean; dirty: boolean }) => void;
}) {
  const [snapshot, setSnapshot] = useState<ImageModelsSnapshot | null>(null);
  const [editor, setEditor] = useState<ImageModelDraft | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const busyRef = useRef(false);
  const alive = useRef(true);
  const nameInput = useRef<HTMLInputElement>(null);
  const addButton = useRef<HTMLButtonElement>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    invoke<ImageModelsSnapshot>("load_image_models").then((result) => {
      if (!cancelled) setSnapshot(result);
    }).catch(() => {
      if (!cancelled) setError(t("读取生图模型失败，请刷新后重试；原配置未被替换。"));
    });
    return () => { cancelled = true; alive.current = false; };
  }, []);

  useEffect(() => {
    onPendingChange({ busy, dirty: editor !== null });
  }, [busy, editor, onPendingChange]);

  useEffect(() => {
    if (editor) nameInput.current?.focus();
  }, [editor?.id]);

  async function persist(models: ImageModelEdit[]): Promise<boolean> {
    if (!snapshot || busyRef.current) return false;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      const result = await invoke<ImageModelsSnapshot>("save_image_models", { revision: snapshot.revision, models });
      if (alive.current) {
        setSnapshot(result);
        setStatus(t("已保存，下一次 MCP 生图调用使用新配置。"));
      }
      return true;
    } catch (failure) {
      if (alive.current) {
        const detail = typeof failure === "string" ? failure : t("保存失败，请重试。");
        setError(t(detail));
      }
      return false;
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  }

  function closeEditor() {
    setEditor(null);
    addButton.current?.focus();
  }

  async function saveEditor(event: FormEvent) {
    event.preventDefault();
    if (!editor || !snapshot) return;
    const issue = validateImageModel(editor);
    if (issue) {
      setError({
        model: t("请输入有效的 Model 名称。"),
        url: t("请输入 HTTP/HTTPS API 地址，不要包含凭据、查询参数或片段。"),
        key: t("请输入 API Key；已有配置留空可保留原 Key。"),
      }[issue]);
      return;
    }
    if (await persist(upsertImageModel(snapshot.models, editor))) closeEditor();
  }

  async function reorder(activeId: string, overId: string) {
    if (!snapshot || editor || busyRef.current) return;
    const models = reorderImageModels(snapshot.models, activeId, overId);
    if (models !== snapshot.models) await persist(imageModelEdits(models));
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (over) void reorder(String(active.id), String(over.id));
  }

  const models = snapshot?.models ?? [];
  const disabled = busy || !snapshot || editor !== null;

  return (
    <div className="image-models-screen" aria-busy={busy}>
      <div className="image-models-toolbar">
        <div>
          <h2>{t("MCP 生图配置")}</h2>
          <p>{t("拖动手柄上下排序，最上方为默认模型；排序会自动保存。")}</p>
        </div>
        <Button ref={addButton} disabled={disabled} onClick={() => {
          setError("");
          setStatus("");
          setDeleting(null);
          setEditor({ id: crypto.randomUUID(), name: "", baseUrl: "", model: "", hasApiKey: false, apiKey: "" });
        }}>
          <Plus className="h-4 w-4" />{t("添加生图模型")}
        </Button>
      </div>

      <div className="image-models-feedback" aria-live="polite">
        {busy ? <span>{t("正在保存生图模型…")}</span> : status ? <span className="image-models-saved"><Check className="h-4 w-4" />{status}</span> : null}
        {error ? <p role="alert" className="image-models-error">{error}</p> : null}
      </div>

      {editor ? (
        <form className="image-model-editor" onSubmit={(event) => void saveEditor(event)} aria-label={t("生图模型编辑")}>
          <div className="image-model-editor-heading">
            <h3>{models.some((model) => model.id === editor.id) ? t("编辑生图模型") : t("添加生图模型")}</h3>
            <Button type="button" size="icon" variant="ghost" disabled={busy} onClick={closeEditor} aria-label={t("取消编辑")}><X className="h-4 w-4" /></Button>
          </div>
          <fieldset disabled={busy} className="image-model-editor-fields">
            <div><Label htmlFor="image-model-name">{t("名称（可选）")}</Label>
              <Input ref={nameInput} id="image-model-name" maxLength={256} value={editor.name} placeholder={t("例如：常用生图")}
                onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></div>
            <div><Label htmlFor="image-model-model">Model</Label>
              <Input id="image-model-model" required maxLength={256} autoCapitalize="off" spellCheck={false} value={editor.model} placeholder="gpt-image-2"
                onChange={(event) => setEditor({ ...editor, model: event.target.value })} /></div>
            <div className="image-model-wide"><Label htmlFor="image-model-api">{t("API 地址")}</Label>
              <Input id="image-model-api" required type="url" autoCapitalize="off" spellCheck={false} value={editor.baseUrl} placeholder="https://api.example.com/v1"
                onChange={(event) => setEditor({ ...editor, baseUrl: event.target.value })} />
              <p>{t("使用兼容 OpenAI Images 的 API 基础地址，支持生成与图片编辑。")}</p></div>
            <div className="image-model-wide"><Label htmlFor="image-model-key">API Key</Label>
              <Input id="image-model-key" type="password" autoComplete="new-password" spellCheck={false} required={!editor.hasApiKey}
                value={editor.apiKey} placeholder={editor.hasApiKey ? t("已保存，留空保留原 Key") : t("输入 API Key")}
                onChange={(event) => setEditor({ ...editor, apiKey: event.target.value })} />
              <p>{t("Key 仅保存在本机配置中，不会显示在模型列表或发送给对话模型。")}</p></div>
          </fieldset>
          <div className="image-model-editor-actions">
            <Button type="button" variant="outline" disabled={busy} onClick={closeEditor}>{t("取消")}</Button>
            <Button type="submit" disabled={busy}><Save className="h-4 w-4" />{t("保存生图模型")}</Button>
          </div>
        </form>
      ) : null}

      {!snapshot && !error ? <p>{t("正在读取生图模型…")}</p> : null}
      {snapshot && models.length === 0 && !editor ? (
        <div className="image-models-empty">
          <ImagePlus className="h-9 w-9" aria-hidden="true" />
          <h3>{t("还没有独立的生图模型")}</h3>
          <p>{t("添加 API、Key 和 Model，第一项会自动成为默认模型。")}</p>
        </div>
      ) : null}

      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setDeleting(null)} onDragEnd={onDragEnd}
        accessibility={{ screenReaderInstructions: { draggable: t("按空格开始排序，使用上下箭头移动，再按空格保存；按 Escape 取消。") } }}>
        <SortableContext items={models.map((model) => model.id)} strategy={verticalListSortingStrategy}>
          <div className="image-model-list" aria-label={t("生图模型优先级")} role="list">
            {models.map((model, index) => (
              <ImageModelRow key={model.id} model={model} index={index} total={models.length} disabled={disabled}
                onMove={(delta) => void reorder(model.id, models[index + delta].id)}
                onEdit={() => { setDeleting(null); setError(""); setEditor({ ...model, apiKey: "" }); }}
                onDelete={() => setDeleting(model.id)} deleting={deleting === model.id}
                onCancelDelete={() => setDeleting(null)}
                onConfirmDelete={() => {
                  void persist(imageModelEdits(models.filter((item) => item.id !== model.id))).then((saved) => {
                    if (saved) setDeleting(null);
                  });
                }} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <p className="image-models-note">{t("未配置生图模型时，继续使用当前对话供应商和原默认生图模型；不会自动切换或重试其他生图配置。")}</p>
      <p className="image-models-note">{t("首次使用需保持增强功能开启，并通过 Alunixa X 启动 Codex 以加载 MCP；已加载的 MCP 无需重启即可读取后续配置。")}</p>
    </div>
  );
}

function ImageModelRow({ model, index, total, disabled, onMove, onEdit, onDelete, deleting, onCancelDelete, onConfirmDelete }: {
  model: ImageModelSummary; index: number; total: number; disabled: boolean;
  onMove: (delta: number) => void; onEdit: () => void; onDelete: () => void;
  deleting: boolean; onCancelDelete: () => void; onConfirmDelete: () => void;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: model.id, disabled });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 2 : undefined };
  return (
    <div ref={setNodeRef} style={style} role="listitem" data-image-model-id={model.id} className={`image-model-row ${index === 0 ? "is-default" : ""} ${isDragging ? "is-dragging" : ""}`}>
      <div className="image-model-row-main">
        <button ref={setActivatorNodeRef} type="button" className="image-model-drag" disabled={disabled}
          {...attributes} {...listeners} aria-label={tf("拖动生图模型 {0}", [model.name])}><GripVertical className="h-5 w-5" /></button>
        <span className="image-model-order">{String(index + 1).padStart(2, "0")}</span>
        <div className="image-model-row-copy">
          <div className="image-model-row-title"><h3>{model.name}</h3>{index === 0 ? <Badge>{t("默认")}</Badge> : null}</div>
          <code>{model.model}</code><p>{model.baseUrl}</p>
        </div>
        <div className="image-model-row-actions">
          <Button size="icon" variant="ghost" disabled={disabled || index === 0} onClick={() => onMove(-1)} aria-label={t("上移")} title={t("上移")}><ArrowUp className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" disabled={disabled || index === total - 1} onClick={() => onMove(1)} aria-label={t("下移")} title={t("下移")}><ArrowDown className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" disabled={disabled} onClick={onEdit} aria-label={t("编辑")} title={t("编辑")}><Pencil className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" disabled={disabled} onClick={onDelete} aria-label={t("删除")} title={t("删除")}><Trash2 className="h-4 w-4" /></Button>
        </div>
      </div>
      {deleting ? <div className="image-model-delete" role="group" aria-label={t("删除生图模型")}>
        <span>{index === 0 ? t("删除默认项后，下一项将成为默认；删除全部后恢复原供应商。") : t("确定删除此生图模型？")}</span>
        <Button size="sm" variant="outline" disabled={disabled} onClick={onCancelDelete}>{t("取消")}</Button>
        <Button size="sm" variant="outline" className="text-destructive" disabled={disabled} onClick={onConfirmDelete}>{t("确认删除")}</Button>
      </div> : null}
    </div>
  );
}
