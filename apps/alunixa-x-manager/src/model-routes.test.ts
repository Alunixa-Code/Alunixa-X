import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  findRelayModelRouteIssue,
  modelRouteSaveRequiresRestart,
  PROTOCOL_PROXY_BASE_URL,
  type RelayModelRouteProfile,
  type RelayModelRouteSettings,
} from "./model-routes.ts";

function profile(id: string, patch: Partial<RelayModelRouteProfile> = {}): RelayModelRouteProfile {
  return {
    id,
    name: id.toUpperCase(),
    baseUrl: `https://${id}.example/v1`,
    apiKey: `sk-${id}`,
    protocol: "responses",
    relayMode: "pureApi",
    officialMixApiKey: false,
    modelRoutes: [],
    ...patch,
  };
}

function settings(
  relayProfiles: RelayModelRouteProfile[],
  patch: Partial<RelayModelRouteSettings> = {},
): RelayModelRouteSettings {
  return {
    relayProfilesEnabled: true,
    activeRelayId: relayProfiles[0]?.id ?? "",
    relayProfiles,
    ...patch,
  };
}

test("model route inputs use stable keys while the model name changes", async () => {
  const source = await readFile(new URL("./App.tsx", import.meta.url), "utf8");

  assert.match(source, /key=\{`model-route-\$\{index\}`\}/);
  assert.doesNotMatch(source, /key=\{`\$\{route\.model\}-\$\{index\}`\}/);
  assert.match(source, /placeholder=\{t\("例：gpt-5\.6-luna"\)\}/);
  assert.match(source, /relayModelRoutesSettingsValidation\(validationSettings\)/);
});

test("route validation checks reverse references against the proposed settings", () => {
  const source = profile("source", {
    modelRoutes: [{ model: "gpt-5.6-luna", targetRelayId: "target", targetModel: "" }],
  });
  const secondSource = profile("second-source", {
    modelRoutes: [{ model: "gpt-5.6-terra", targetRelayId: "target", targetModel: "" }],
  });

  assert.equal(findRelayModelRouteIssue([source, secondSource], [source, secondSource, profile("target")]), null);
  assert.equal(
    findRelayModelRouteIssue(
      [source, secondSource],
      [source, secondSource, profile("target", { protocol: "chatCompletions" })],
    )?.kind,
    "targetProtocol",
  );
  assert.equal(
    findRelayModelRouteIssue([source], [source, profile("target", { baseUrl: "" })])?.kind,
    "targetCredentials",
  );
  assert.equal(
    findRelayModelRouteIssue([source], [source, profile("target", { apiKey: "" })])?.kind,
    "targetCredentials",
  );
  assert.equal(
    findRelayModelRouteIssue([source], [source, profile("target", {
      relayMode: "official",
      officialMixApiKey: false,
    })])?.kind,
    "targetCredentials",
  );
});

test("route validation rejects incomplete, duplicate, self, missing and aggregate targets", () => {
  assert.equal(
    findRelayModelRouteIssue([
      profile("source", { modelRoutes: [{ model: "", targetRelayId: "target", targetModel: "" }] }),
    ], [profile("source"), profile("target")])?.kind,
    "incomplete",
  );
  const duplicate = profile("source", {
    modelRoutes: [
      { model: "gpt-5.6-luna", targetRelayId: "target", targetModel: "" },
      { model: "gpt-5.6-luna", targetRelayId: "target", targetModel: "gpt-5.6-sol" },
    ],
  });
  assert.equal(findRelayModelRouteIssue([duplicate], [duplicate, profile("target")])?.kind, "duplicate");
  const self = profile("source", {
    modelRoutes: [{ model: "gpt-5.6-luna", targetRelayId: "source", targetModel: "" }],
  });
  assert.equal(findRelayModelRouteIssue([self], [self])?.kind, "self");
  const missing = profile("source", {
    modelRoutes: [{ model: "gpt-5.6-luna", targetRelayId: "missing", targetModel: "" }],
  });
  assert.equal(findRelayModelRouteIssue([missing], [missing])?.kind, "missingTarget");
  const aggregate = profile("aggregate", { relayMode: "aggregate" });
  const routed = profile("source", {
    modelRoutes: [{ model: "gpt-5.6-luna", targetRelayId: "aggregate", targetModel: "" }],
  });
  assert.equal(findRelayModelRouteIssue([routed], [routed, aggregate])?.kind, "aggregateTarget");
  const customModels = profile("custom", { relayMode: "customModels", baseUrl: PROTOCOL_PROXY_BASE_URL });
  const customRouted = profile("source", {
    modelRoutes: [{ model: "gpt-5.6-luna", targetRelayId: "custom", targetModel: "" }],
  });
  assert.equal(
    findRelayModelRouteIssue([customRouted], [customRouted, customModels])?.kind,
    "localProxyTarget",
  );
});

test("first active route requires a restart until live config uses the proxy", () => {
  const target = profile("target");
  const source = profile("source");
  const before = settings([source, target]);
  const routed = profile("source", {
    modelRoutes: [{ model: "gpt-5.6-luna", targetRelayId: "target", targetModel: "" }],
  });
  const after = settings([routed, target]);

  assert.equal(modelRouteSaveRequiresRestart(before, after, source.baseUrl), true);
  assert.equal(modelRouteSaveRequiresRestart(after, after, routed.baseUrl), true);
  assert.equal(modelRouteSaveRequiresRestart(after, after, PROTOCOL_PROXY_BASE_URL), false);
  assert.equal(
    modelRouteSaveRequiresRestart(
      { ...before, relayProfilesEnabled: false },
      { ...after, relayProfilesEnabled: false },
      source.baseUrl,
    ),
    false,
  );
});
