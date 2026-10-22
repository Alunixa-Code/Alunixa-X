import { hasModelProtocols } from "./model-protocols.ts";

export type RelayModelRoute = {
  model: string;
  targetRelayId: string;
  targetModel: string;
};

export type RelayModelRouteProfile = {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  protocol: string;
  relayMode: string;
  officialMixApiKey: boolean;
  noAuth?: boolean;
  webSearchHistoryCompat?: boolean;
  strictResponsesReasoning?: boolean;
  modelMetadata?: string;
  modelRoutes?: RelayModelRoute[];
  modelProtocols?: string;
};

export type RelayModelRouteSettings = {
  enhancementsEnabled?: boolean;
  relayProfilesEnabled: boolean;
  activeRelayId: string;
  relayProfiles: RelayModelRouteProfile[];
};

export const PROTOCOL_PROXY_BASE_URL = "http://127.0.0.1:57321/v1";

// 独立代理保存在后端 sidecar；前端只缓存是否启用，不把地址/凭据写入供应商快照。
const independentProxyProfiles = new Set<string>();

export function setIndependentProxyConfigured(profileId: string, configured: boolean): void {
  if (configured) independentProxyProfiles.add(profileId);
  else independentProxyProfiles.delete(profileId);
}

export function independentProxyEnabled(
  profile: Pick<RelayModelRouteProfile, "relayMode" | "officialMixApiKey"> & { id?: string },
): boolean {
  return !!profile.id && independentProxyProfiles.has(profile.id)
    && (profile.relayMode !== "official" || profile.officialMixApiKey);
}

export type RelayModelRouteIssue = {
  kind:
    | "incomplete"
    | "duplicate"
    | "self"
    | "missingTarget"
    | "aggregateTarget"
    | "localProxyTarget"
    | "targetProtocol"
    | "targetCredentials";
  model: string;
  sourceRelayId: string;
};

export function normalizeRelayModelRoutes(routes: RelayModelRoute[] | undefined): RelayModelRoute[] {
  if (!Array.isArray(routes)) return [];
  return routes.map((route) => ({
    model: typeof route?.model === "string" ? route.model : "",
    targetRelayId: typeof route?.targetRelayId === "string" ? route.targetRelayId : "",
    targetModel: typeof route?.targetModel === "string" ? route.targetModel : "",
  }));
}

export function findRelayModelRouteIssue(
  sources: RelayModelRouteProfile[],
  allProfiles: RelayModelRouteProfile[],
): RelayModelRouteIssue | null {
  for (const source of sources) {
    if (source.relayMode === "aggregate" || source.relayMode === "customModels") continue;
    const seenModels = new Set<string>();
    for (const route of normalizeRelayModelRoutes(source.modelRoutes)) {
      const model = route.model.trim();
      const targetRelayId = route.targetRelayId.trim();
      if (!model || !targetRelayId) return { kind: "incomplete", model, sourceRelayId: source.id };
      if (seenModels.has(model)) return { kind: "duplicate", model, sourceRelayId: source.id };
      seenModels.add(model);
      if (targetRelayId === source.id) return { kind: "self", model, sourceRelayId: source.id };
      const target = allProfiles.find((candidate) => candidate.id === targetRelayId);
      if (!target) return { kind: "missingTarget", model, sourceRelayId: source.id };
      if (target.relayMode === "aggregate") return { kind: "aggregateTarget", model, sourceRelayId: source.id };
      if (target.relayMode === "customModels") return { kind: "localProxyTarget", model, sourceRelayId: source.id };
      if (target.protocol !== "responses") return { kind: "targetProtocol", model, sourceRelayId: source.id };
      const targetHasApiCredentials =
        !(target.relayMode === "official" && !target.officialMixApiKey)
        && Boolean(target.baseUrl.trim() && target.apiKey.trim());
      if (!targetHasApiCredentials) return { kind: "targetCredentials", model, sourceRelayId: source.id };
    }
  }
  return null;
}

export function webSearchHistoryCompatEnabled(
  profile: Pick<RelayModelRouteProfile, "protocol" | "relayMode" | "officialMixApiKey" | "webSearchHistoryCompat">,
): boolean {
  return profile.webSearchHistoryCompat === true
    && profile.protocol === "responses"
    && profile.relayMode !== "aggregate"
    && (profile.relayMode !== "official" || profile.officialMixApiKey);
}

export function settingsRequireLocalHelper(settings: RelayModelRouteSettings): boolean {
  if (settings.enhancementsEnabled) return true;
  const active = settings.relayProfiles.find((profile) => profile.id === settings.activeRelayId)
    ?? settings.relayProfiles[0];
  if (!active) return false;
  return active.relayMode === "aggregate"
    || active.protocol !== "responses"
    || hasModelProtocols(active.modelProtocols)
    || (active.relayMode === "pureApi" && active.noAuth === true)
    || (active.relayMode === "official" && active.officialMixApiKey)
    || independentProxyEnabled(active)
    || webSearchHistoryCompatEnabled(active)
    || requestCompatibilityEnabled(active)
    || normalizeRelayModelRoutes(active.modelRoutes).some(
      (route) => Boolean(route.model.trim() && route.targetRelayId.trim()),
    );
}

export function requestCompatibilityEnabled(profile: Pick<RelayModelRouteProfile, "protocol" | "relayMode" | "officialMixApiKey" | "strictResponsesReasoning" | "modelMetadata">): boolean {
  if (profile.relayMode === "official" && !profile.officialMixApiKey) return false;
  if (profile.protocol === "responses" && profile.strictResponsesReasoning === true) return true;
  if (!profile.modelMetadata?.includes("alunixa_x_reasoning_parameters")) return false;
  try {
    const map: unknown = JSON.parse(profile.modelMetadata);
    return !!map && typeof map === "object" && !Array.isArray(map) && Object.values(map).some((entry) =>
      entry && typeof entry === "object" && ["omit", "passthrough"].includes(entry.alunixa_x_reasoning_parameters));
  } catch { return false; }
}

export function modelRouteSaveRequiresRestart(
  current: RelayModelRouteSettings,
  proposed: RelayModelRouteSettings,
  activeLiveBaseUrl: string,
): boolean {
  if (!proposed.relayProfilesEnabled) return false;
  const active = proposed.relayProfiles.find((profile) => profile.id === proposed.activeRelayId)
    ?? proposed.relayProfiles[0];
  const activeHasRoutes = active
    ? hasModelProtocols(active.modelProtocols) || independentProxyEnabled(active) || requestCompatibilityEnabled(active) || webSearchHistoryCompatEnabled(active) || normalizeRelayModelRoutes(active.modelRoutes).some(
      (route) => Boolean(route.model.trim() && route.targetRelayId.trim()),
    )
    : false;
  if (!activeHasRoutes) return false;
  const currentActive = current.relayProfiles.find((profile) => profile.id === current.activeRelayId)
    ?? current.relayProfiles[0];
  const currentActiveHasRoutes = currentActive
    ? hasModelProtocols(currentActive.modelProtocols) || independentProxyEnabled(currentActive) || requestCompatibilityEnabled(currentActive) || webSearchHistoryCompatEnabled(currentActive) || normalizeRelayModelRoutes(currentActive.modelRoutes).some(
      (route) => Boolean(route.model.trim() && route.targetRelayId.trim()),
    )
    : false;
  if (!currentActiveHasRoutes) return true;
  return activeLiveBaseUrl.trim() !== PROTOCOL_PROXY_BASE_URL;
}
