export type ImageModelSummary = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  hasApiKey: boolean;
};

export type ImageModelsSnapshot = {
  models: ImageModelSummary[];
  revision: string;
};

export type ImageModelEdit = Omit<ImageModelSummary, "hasApiKey"> & { apiKey: string | null };
export type ImageModelDraft = ImageModelSummary & { apiKey: string };

export function imageModelEdits(models: ImageModelSummary[]): ImageModelEdit[] {
  return models.map(({ id, name, baseUrl, model }) => ({ id, name, baseUrl, model, apiKey: null }));
}

export function reorderImageModels<T extends { id: string }>(models: T[], activeId: string, overId: string): T[] {
  const from = models.findIndex((model) => model.id === activeId);
  const to = models.findIndex((model) => model.id === overId);
  if (from < 0 || to < 0 || from === to) return models;
  const result = [...models];
  result.splice(to, 0, result.splice(from, 1)[0]);
  return result;
}

export function validateImageModel(draft: ImageModelDraft): "model" | "url" | "key" | null {
  if (!draft.model.trim() || draft.model.trim().length > 256 || /[\u0000-\u001f\u007f]/.test(draft.model)) return "model";
  try {
    const url = new URL(draft.baseUrl.trim());
    if (!["http:", "https:"].includes(url.protocol) || !url.hostname
      || url.username || url.password || url.search || url.hash) return "url";
  } catch {
    return "url";
  }
  if ((!draft.apiKey.trim() && !draft.hasApiKey) || /[\r\n]/.test(draft.apiKey)) return "key";
  return null;
}

export function upsertImageModel(models: ImageModelSummary[], draft: ImageModelDraft): ImageModelEdit[] {
  const edits = imageModelEdits(models);
  const item: ImageModelEdit = {
    id: draft.id,
    name: draft.name.trim() || draft.model.trim(),
    model: draft.model.trim(),
    baseUrl: draft.baseUrl.trim(),
    apiKey: draft.apiKey.trim() || null,
  };
  const index = edits.findIndex((model) => model.id === draft.id);
  if (index < 0) edits.push(item);
  else edits[index] = item;
  return edits;
}
