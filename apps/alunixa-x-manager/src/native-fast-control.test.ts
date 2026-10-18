import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as React from "react";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../../../assets/inject/renderer-inject/31-native-service-tier.js", import.meta.url), "utf8");
const extract = (name: string) => {
  const body = source.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"))?.[0];
  assert.ok(body, name);
  return body;
};
const { patchProps, install, cloneTrigger } = new Function(`
  ${extract("patchCodexNativeFastControlProps")}
  ${extract("installCodexNativeFastJsxPatch")}
  ${extract("cloneCodexNativeFastTrigger")}
  return { patchProps: patchCodexNativeFastControlProps, install: installCodexNativeFastJsxPatch,
    cloneTrigger: cloneCodexNativeFastTrigger };
`)();

function fixture() {
  const calls: unknown[] = [];
  const nativeSelect = () => { throw new Error("the hidden native callback must not handle relay selections"); };
  const select = (value: unknown) => { calls.push(value); };
  const options = Object.freeze([
    Object.freeze({ value: null, label: "Standard", iconKind: "standard" }),
    Object.freeze({ value: "priority", label: "Fast", iconKind: "fast" }),
  ]);
  const props = Object.freeze({
    model: "relay-model",
    selectedServiceTier: null,
    serviceTierOptions: Object.freeze([]),
    serviceTierOptionsLoading: true,
    onSelectServiceTier: nativeSelect,
    onSelectModel: () => {},
    triggerButton: Object.freeze({ type: "native-trigger" }),
    reasoningEffort: "high",
    open: true,
  });
  const context = {
    enabled: true,
    authMethod: "apikey",
    hostId: "local",
    status: "ready",
    selectedServiceTier: "priority" as string | null,
    onSelectServiceTier: select,
    isModelSupported: (model: string) => model === "relay-model",
    serviceTierOptions: options,
  };
  return { props, context, options, calls, nativeSelect, select };
}

test("native Fast supplies relay speed props without replacing model controls or the native trigger", () => {
  const f = fixture();
  const result = patchProps(f.props, f.context);
  assert.notEqual(result, f.props);
  assert.equal(result.selectedServiceTier, "priority");
  assert.equal(result.serviceTierOptions, f.options);
  assert.equal(result.serviceTierOptionsLoading, false);
  assert.equal(result.onSelectServiceTier, f.select);
  for (const key of ["model", "onSelectModel", "triggerButton", "reasoningEffort", "open"] as const) {
    assert.equal(result[key], f.props[key], key);
  }
  assert.deepEqual(Object.keys(result).sort(), Object.keys(f.props).sort());
  assert.equal(f.props.selectedServiceTier, null);
  assert.equal(f.props.serviceTierOptions.length, 0);
  assert.equal(f.props.serviceTierOptionsLoading, true);
  assert.equal(f.props.onSelectServiceTier, f.nativeSelect);
});

test("native Fast forwards each speed choice exactly once to the relay controller", () => {
  const f = fixture();
  const result = patchProps(f.props, f.context);
  result.onSelectServiceTier("priority");
  result.onSelectServiceTier(null);
  assert.deepEqual(f.calls, ["priority", null]);
  const standard = patchProps(f.props, { ...f.context, selectedServiceTier: null });
  assert.equal(standard.selectedServiceTier, null);
});

test("the native trigger config carries Fast and Standard glyphs while preserving all other configuration", () => {
  const f = fixture();
  const onClick = () => {};
  const nativeLabel = Object.freeze({ text: "GPT-6 Astra" });
  const config = Object.freeze({
    selectedServiceTierIconKind: null,
    label: nativeLabel,
    onClick,
    disabled: false,
    openLabel: "选择强度",
  });
  const props = Object.freeze({ ...f.props, modelPickerTriggerConfig: config });
  const fast = patchProps(props, f.context);
  assert.notEqual(fast.modelPickerTriggerConfig, config);
  assert.deepEqual(fast.modelPickerTriggerConfig, { ...config, selectedServiceTierIconKind: "fast" });
  assert.equal(fast.modelPickerTriggerConfig.label, nativeLabel);
  assert.equal(fast.modelPickerTriggerConfig.onClick, onClick);
  assert.equal(config.selectedServiceTierIconKind, null, "the original native config is not mutated");
  const standard = patchProps(props, { ...f.context, selectedServiceTier: null });
  assert.deepEqual(standard.modelPickerTriggerConfig, config);
  assert.equal(standard.modelPickerTriggerConfig.selectedServiceTierIconKind, null);
  assert.equal(standard.modelPickerTriggerConfig.label, nativeLabel);
  assert.equal(standard.modelPickerTriggerConfig.onClick, onClick);
});

for (const [label, changes] of [
  ["disabled controls", { enabled: false }],
  ["official ChatGPT login", { authMethod: "chatgpt" }],
  ["unknown login", { authMethod: undefined }],
  ["remote host", { hostId: "remote-workstation" }],
  ["unknown host", { hostId: undefined }],
  ["empty host", { hostId: "" }],
  ["pending capabilities", { status: "loading" }],
  ["failed capabilities", { status: "failed" }],
] as Array<[string, Record<string, unknown>]>) {
  test(`native Fast leaves the original props untouched for ${label}`, () => {
    const f = fixture();
    assert.equal(patchProps(f.props, { ...f.context, ...changes }), f.props);
    assert.deepEqual(f.calls, []);
  });
}

test("native Fast keeps existing official or provider-supplied speed options and callbacks", () => {
  const f = fixture();
  const nativeOptions = [{ value: "flex", label: "Flex" }];
  const props = Object.freeze({ ...f.props, serviceTierOptions: nativeOptions });
  assert.equal(patchProps(props, f.context), props);
  assert.equal(props.serviceTierOptions, nativeOptions);
  assert.equal(props.onSelectServiceTier, f.nativeSelect);
});

test("native Fast uses the picker model and declines unsupported or missing model identities", () => {
  const f = fixture();
  const checked: unknown[] = [];
  const context = { ...f.context, isModelSupported: (model: unknown) => { checked.push(model); return model === "relay-model"; } };
  assert.notEqual(patchProps(f.props, context), f.props);
  assert.deepEqual(checked, ["relay-model"]);
  for (const model of ["unverified-fast-model", "", undefined]) {
    const props = { ...f.props, model };
    assert.equal(patchProps(props, context), props);
  }
});

test("native Fast safely leaves malformed props alone", () => {
  const f = fixture();
  for (const props of [null, undefined]) assert.equal(patchProps(props, f.context), props);
});

test("the native trigger finds the model label inside selectedValue and switches its genuine Fast glyph", () => {
  const NativeLabel = (_props: any) => null;
  const DropdownValue = (_props: any) => null;
  const onClick = () => {};
  const label = React.createElement(NativeLabel, { modelLabel: "GPT-6 Astra", serviceTierIconKind: null, onClick });
  const value = React.createElement(DropdownValue, { selectedValue: label, "aria-label": "Select model" });
  const trigger = React.createElement("button", { onClick, disabled: false }, value);
  const readLabel = (node: React.ReactElement<any>) => {
    assert.ok(React.isValidElement(node.props.children), "single children must remain an element, not become an array");
    const dropdown = node.props.children as React.ReactElement<any>;
    assert.ok(React.isValidElement(dropdown.props.selectedValue), "the native dropdown requires its single selectedValue element");
    return dropdown.props.selectedValue as React.ReactElement<any>;
  };
  const fast = cloneTrigger(React, NativeLabel, trigger, "priority");
  const fastLabel = readLabel(fast);
  assert.equal(fastLabel.type, NativeLabel);
  assert.equal(fastLabel.props.serviceTierIconKind, "fast");
  assert.equal(fastLabel.props.modelLabel, "GPT-6 Astra");
  assert.equal(fastLabel.props.onClick, onClick);
  assert.equal(fast.type, "button");
  assert.equal(fast.props.onClick, onClick);
  assert.equal(fast.props.disabled, false);
  assert.equal(label.props.serviceTierIconKind, null, "the original React element remains unchanged");
  const standard = cloneTrigger(React, NativeLabel, fast, null);
  assert.equal(readLabel(standard).props.serviceTierIconKind, null);
  assert.equal(readLabel(standard).props.modelLabel, "GPT-6 Astra");
  assert.equal(standard.props.onClick, onClick);
});

test("the native trigger only changes the exact native label and never traverses arbitrary prop objects", () => {
  const NativeLabel = (_props: any) => null;
  const SimilarLabel = (_props: any) => null;
  const unrelated = React.createElement(SimilarLabel, { serviceTierIconKind: "preserve", modelLabel: "Other label" });
  const hiddenLabel = React.createElement(NativeLabel, { serviceTierIconKind: null });
  const selectedLabel = React.createElement(NativeLabel, { serviceTierIconKind: null });
  const trigger = React.createElement("button", {
    children: [unrelated], selectedValue: [selectedLabel, "suffix"], renderLabel: hiddenLabel,
  } as any);
  const result = cloneTrigger(React, NativeLabel, trigger, "priority");
  assert.ok(Array.isArray(result.props.children), "existing child arrays keep their shape");
  const child = React.Children.toArray(result.props.children)[0] as React.ReactElement<any>;
  assert.equal(child.type, SimilarLabel);
  assert.equal(child.props.serviceTierIconKind, "preserve");
  assert.equal(child.props.modelLabel, "Other label");
  assert.equal(result.props.renderLabel, hiddenLabel);
  assert.equal(hiddenLabel.props.serviceTierIconKind, null);
  assert.ok(Array.isArray(result.props.selectedValue), "existing selectedValue arrays keep their shape");
  assert.equal(result.props.selectedValue[0].props.serviceTierIconKind, "fast");
  assert.equal(result.props.selectedValue[1], "suffix");
  assert.equal(cloneTrigger(React, NativeLabel, unrelated, "priority"), unrelated);
});

test("native trigger traversal is bounded and preserves text and non-elements", () => {
  const NativeLabel = (_props: any) => null;
  const label = React.createElement(NativeLabel, { serviceTierIconKind: null });
  let nested: React.ReactElement<any> = label;
  for (let depth = 0; depth < 12; depth++) nested = React.createElement("span", null, nested);
  let result = cloneTrigger(React, NativeLabel, nested, "priority");
  for (let depth = 0; depth < 12; depth++) result = React.Children.toArray(result.props.children)[0];
  assert.equal(result.props.serviceTierIconKind, null, "unknown deeply nested component trees are left alone");
  for (const value of ["GPT-6 Astra", null, undefined, 5]) {
    assert.equal(cloneTrigger(React, NativeLabel, value, "priority"), value);
  }
});

function liveContextFixture() {
  let ref: { session_id: string; host_id?: string } = { session_id: "thread-12345678", host_id: "local" };
  let client: object | null = {};
  const runtime = { authMethod: "apikey", client, generation: 1, requirementsReady: true, fastAllowed: true };
  const settings = { serviceTierControls: true };
  const backendSettings = { codexAppVersion: "26.1007.30912" };
  const backend = { status: "ok" };
  const tier = { status: "ok", effectiveServiceTier: "priority" as string | null };
  const supported = new Set(["native-picker-model"]);
  const selected: string[] = [];
  const remembered: Array<[string, string]> = [];
  const selectedModels: string[] = [];
  let setterResult = true;
  const checked: unknown[] = [];
  const makeContext = new Function("dependencies", `
    const {
      codexNativeFastControlRuntime, currentSessionRef, validThreadScrollSessionKey,
      codexServiceTierFastSupportedForModel, alunixaXSettings, alunixaXBackendStatus,
      codexServiceTierState, isFastServiceTierValue, codexServiceTierRememberThreadModel,
      setCodexThreadServiceTierMode, nativeHostClient, alunixaXBackendSettings,
    } = dependencies;
    ${extract("codexNativeFastControlEnabled")}
    ${extract("codexNativeFastControlClientReady")}
    ${extract("codexNativeFastControlContext")}
    return codexNativeFastControlContext;
  `)({
    codexNativeFastControlRuntime: runtime,
    currentSessionRef: () => ref,
    validThreadScrollSessionKey: (value: unknown) => typeof value === "string" && value.length >= 8 ? value : "",
    codexServiceTierFastSupportedForModel: (model: unknown) => { checked.push(model); return supported.has(model as string); },
    alunixaXSettings: () => settings,
    alunixaXBackendSettings: backendSettings,
    nativeHostClient: () => client,
    alunixaXBackendStatus: backend,
    codexServiceTierState: tier,
    isFastServiceTierValue: (value: unknown) => value === "fast" || value === "priority",
    codexServiceTierRememberThreadModel: (threadId: string, model: string) => { remembered.push([threadId, model]); },
    setCodexThreadServiceTierMode: (mode: string, model: string) => { selected.push(mode); selectedModels.push(model); return setterResult; },
  });
  return {
    runtime, settings, backendSettings, backend, tier, supported, selected, selectedModels, remembered, checked,
    make: (model = "native-picker-model") => makeContext({ model }),
    setRef: (next: typeof ref) => { ref = next; },
    setClient: (next: object | null) => { client = next; },
    setSetterResult: (next: boolean) => { setterResult = next; },
  };
}

test("the native selection callback uses the visible picker model and writes the current thread once", () => {
  const f = liveContextFixture();
  const context = f.make();
  assert.equal(context.selectedServiceTier, "priority");
  assert.equal(context.status, "ready");
  assert.deepEqual(f.selected, [], "rendering must not select a tier");
  assert.deepEqual(f.remembered, [], "rendering must not overwrite model observations");
  assert.equal(context.onSelectServiceTier("priority"), true);
  assert.deepEqual(f.selected, ["fast"]);
  assert.deepEqual(f.selectedModels, ["native-picker-model"]);
  assert.deepEqual(f.remembered, [["thread-12345678", "native-picker-model"]]);
  assert.ok(f.checked.length >= 2, "support is checked again at selection time");
  assert.ok(f.checked.every((model) => model === "native-picker-model"));
});

test("a native callback forwards the setter's rejection instead of reporting a successful selection", () => {
  const f = liveContextFixture();
  f.setSetterResult(false);
  assert.equal(f.make().onSelectServiceTier("priority"), false);
});

test("native rendering and callbacks decline disappeared or replaced authentication clients immediately", () => {
  for (const next of [null, {}]) {
    const f = liveContextFixture();
    const context = f.make();
    f.setClient(next);
    assert.equal(f.make().authMethod, null);
    assert.equal(context.onSelectServiceTier("priority"), false);
    assert.equal(context.onSelectServiceTier(null), false);
    assert.deepEqual(f.selected, []);
  }
});

test("native Fast admits the current verified Codex Store contract", () => {
  const f = liveContextFixture();
  f.backendSettings.codexAppVersion = "26.1007.2314.0";
  assert.equal(f.make().enabled, true);
});

test("native callbacks decline an older injection, unverified requirements or an enforced Fast prohibition", () => {
  for (const change of [
    (f: ReturnType<typeof liveContextFixture>) => { f.runtime.generation++; },
    (f: ReturnType<typeof liveContextFixture>) => { f.runtime.requirementsReady = false; },
    (f: ReturnType<typeof liveContextFixture>) => { f.runtime.fastAllowed = false; },
    (f: ReturnType<typeof liveContextFixture>) => { f.backendSettings.codexAppVersion = "unknown"; },
  ]) {
    const f = liveContextFixture();
    const context = f.make();
    change(f);
    assert.equal(context.onSelectServiceTier("priority"), false);
    assert.equal(context.onSelectServiceTier(null), false);
    assert.deepEqual(f.selected, []);
  }
});

test("a native menu callback cannot change another thread after navigation", () => {
  const f = liveContextFixture();
  const context = f.make();
  f.setRef({ session_id: "thread-87654321", host_id: "local" });
  assert.equal(context.onSelectServiceTier("priority"), false);
  assert.equal(context.onSelectServiceTier(null), false);
  assert.deepEqual(f.selected, []);
  assert.deepEqual(f.remembered, []);
});

for (const host_id of ["remote-workstation", undefined, ""]) {
  test(`a native menu callback rejects a changed or unknown host (${String(host_id)})`, () => {
    const f = liveContextFixture();
    const context = f.make();
    f.setRef({ session_id: "thread-12345678", host_id });
    assert.equal(context.onSelectServiceTier("priority"), false);
    assert.equal(context.onSelectServiceTier(null), false);
    assert.deepEqual(f.selected, []);
    assert.deepEqual(f.remembered, []);
    assert.equal(f.make().hostId, host_id);
  });
}

test("removing model support while the native menu is open blocks Fast but still allows Standard", () => {
  const f = liveContextFixture();
  const context = f.make();
  f.supported.delete("native-picker-model");
  assert.equal(context.onSelectServiceTier("priority"), false);
  assert.deepEqual(f.selected, []);
  assert.deepEqual(f.remembered, []);
  assert.equal(context.onSelectServiceTier(null), true);
  assert.deepEqual(f.selected, ["standard"]);
  assert.deepEqual(f.remembered, [["thread-12345678", "native-picker-model"]]);
});

test("a native menu callback rechecks controls, backend, tier readiness and authentication", () => {
  const f = liveContextFixture();
  const context = f.make();
  f.settings.serviceTierControls = false;
  assert.equal(context.onSelectServiceTier("priority"), false);
  f.settings.serviceTierControls = true;
  f.backend.status = "failed";
  assert.equal(context.onSelectServiceTier("priority"), false);
  f.backend.status = "ok";
  f.tier.status = "loading";
  assert.equal(context.onSelectServiceTier("priority"), false);
  f.tier.status = "ok";
  f.runtime.authMethod = "chatgpt";
  assert.equal(context.onSelectServiceTier("priority"), false);
  assert.deepEqual(f.selected, []);
  assert.deepEqual(f.remembered, []);
});

test("the native menu callback ignores unknown tier values and supports the standard state", () => {
  const f = liveContextFixture();
  f.tier.effectiveServiceTier = null;
  const context = f.make();
  assert.equal(context.selectedServiceTier, null);
  for (const tier of ["flex", "fast", "ultrafast", "", undefined, false]) {
    assert.equal(context.onSelectServiceTier(tier), false);
  }
  assert.deepEqual(f.selected, []);
  assert.deepEqual(f.remembered, []);
  assert.equal(context.onSelectServiceTier(null), true);
  assert.deepEqual(f.selected, ["standard"]);
});

function factories() {
  const invocations: Array<{ receiver: unknown; args: unknown[] }> = [];
  const jsx = function (this: unknown, ...args: unknown[]) {
    const call = { receiver: this, args };
    invocations.push(call);
    return call;
  };
  const jsxs = function (this: unknown, ...args: unknown[]) {
    const call = { receiver: this, args };
    invocations.push(call);
    return call;
  };
  const native = function NativePicker() { throw new Error("factories must not call the component"); };
  const adapter = function RelayPicker() { throw new Error("factories must not call the adapter"); };
  return { runtime: { jsx, jsxs }, jsx, jsxs, native, adapter, invocations };
}

test("the JSX bridge replaces only the exact native picker and preserves receiver, props, key and extra arguments", () => {
  const f = factories();
  const dispose = install(f.runtime, f.native, f.adapter);
  assert.equal(typeof dispose, "function");
  const receiver = {};
  const props = Object.freeze({ model: "relay-model" });
  const key = "native-picker-key";
  const extra = {};
  const unrelated = function NativePicker() {};
  for (const factory of [f.runtime.jsx, f.runtime.jsxs]) {
    const result = factory.call(receiver, f.native, props, key, extra);
    assert.equal(result.receiver, receiver);
    assert.deepEqual(result.args, [f.adapter, props, key, extra]);
    for (const type of [unrelated, "button", f.adapter, null]) {
      const untouched = factory.call(receiver, type, props, key, extra);
      assert.equal(untouched.receiver, receiver);
      assert.deepEqual(untouched.args, [type, props, key, extra]);
    }
  }
  assert.equal(f.invocations.length, 10);
  dispose();
  assert.equal(f.runtime.jsx, f.jsx);
  assert.equal(f.runtime.jsxs, f.jsxs);
  dispose();
  assert.equal(f.runtime.jsx, f.jsx);
  assert.equal(f.runtime.jsxs, f.jsxs);
});

test("the JSX bridge cleanup preserves another extension's later wrapper", () => {
  const f = factories();
  const dispose = install(f.runtime, f.native, f.adapter);
  const replacement = function () { return "replacement"; };
  (f.runtime as any).jsx = replacement;
  dispose();
  assert.equal(f.runtime.jsx, replacement);
  assert.equal(f.runtime.jsxs, f.jsxs);
});

test("the JSX bridge declines frozen or partly non-writable runtimes without leaving a partial patch", () => {
  const f = factories();
  assert.equal(install(Object.freeze({ ...f.runtime }), f.native, f.adapter), null);
  Object.defineProperty(f.runtime, "jsxs", { value: f.jsxs, writable: false, configurable: false });
  assert.equal(install(f.runtime, f.native, f.adapter), null);
  assert.equal(f.runtime.jsx, f.jsx);
  assert.equal(f.runtime.jsxs, f.jsxs);
});

test("the JSX bridge passes native factory failures through without retrying a render", () => {
  let calls = 0;
  const failure = new Error("native render error");
  const original = (..._args: unknown[]) => { calls++; throw failure; };
  const runtime = { jsx: original, jsxs: original };
  const native = () => {};
  const dispose = install(runtime, native, () => {});
  assert.throws(() => runtime.jsx(native, {}), (error) => error === failure);
  assert.equal(calls, 1);
  dispose();
  assert.equal(runtime.jsx, original);
  assert.equal(runtime.jsxs, original);
});

test("the native selection uses the selected model even when the catalog default cannot use Fast", () => {
  const menu = readFileSync(new URL("../../../assets/inject/renderer-inject/20-menu.js", import.meta.url), "utf8");
  const tiers = readFileSync(new URL("../../../assets/inject/renderer-inject/30-service-tier.js", import.meta.url), "utf8");
  const functionFrom = (text: string, name: string) => {
    const result = text.match(new RegExp(`^  function ${name}\\([^]*?^  \\}`, "m"))?.[0];
    assert.ok(result, name);
    return result;
  };
  const writes: unknown[] = [];
  const client = {};
  const fixture = runInNewContext(`
    ${functionFrom(menu, "codexServiceTierUiModelName")}
    ${functionFrom(menu, "codexServiceTierFastAvailability")}
    ${functionFrom(tiers, "setCodexThreadServiceTierMode")}
    ${extract("codexNativeFastControlEnabled")}
    ${extract("codexNativeFastControlClientReady")}
    ${extract("codexNativeFastControlContext")}
    ({ make: codexNativeFastControlContext, set: setCodexThreadServiceTierMode });
  `, {
    codexNativeFastControlRuntime: { client, authMethod: "apikey", generation: 1, requirementsReady: true, fastAllowed: true },
    nativeHostClient: () => client,
    currentSessionRef: () => ({ session_id: "thread-12345678", host_id: "local" }),
    validThreadScrollSessionKey: (value: string) => value || "",
    alunixaXSettings: () => ({ serviceTierControls: true }),
    alunixaXBackendSettings: { codexAppVersion: "26.1007.30912" },
    alunixaXBackendStatus: { status: "ok" },
    codexServiceTierState: { status: "ok", effectiveServiceTier: null },
    isFastServiceTierValue: (value: unknown) => value === "priority",
    codexServiceTierThreadModels: new Map([["thread-12345678", "supported-selected"]]),
    codexServiceTierRememberThreadModel: () => {},
    codexServiceTierCurrentModelName: () => "unsupported-default",
    codexServiceTierFastSupportedForModel: (value: string) => value === "supported-selected",
    normalizeCodexServiceTierModelName: (value: string) => value || "",
    normalizeCodexThreadServiceTierMode: (value: string) => value,
    codexServiceTierMaybeLoadModelCatalog: () => {},
    codexServiceTierFastUnsupportedMessage: (value: string) => value,
    showToast: () => {},
    refreshCodexServiceTierControls: () => {},
    setCodexThreadServiceTierOverride: (threadId: string, mode: string) => writes.push({ threadId, mode }),
  });
  assert.equal(fixture.make({ model: "supported-selected" }).onSelectServiceTier("priority"), true);
  assert.deepEqual(writes, [{ threadId: "thread-12345678", mode: "fast" }]);
  assert.equal(fixture.set("fast"), true, "existing callers use the current thread's remembered model");
  assert.equal(fixture.set("fast", "unsupported-default"), false);
  assert.equal(writes.length, 2);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function installerFixture() {
  let now = 10000;
  const settings = { serviceTierControls: true };
  const backendSettings = { codexAppVersion: "26.1007.30912" };
  const calls: Array<{ method: string; params: unknown }> = [];
  let auth: () => Promise<unknown> = async () => ({ authMethod: "apikey" });
  let policy: () => Promise<unknown> = async () => ({ requirements: null });
  let client: { sendRequest: (method: string, params?: unknown) => Promise<unknown> } | null = {
    sendRequest: async (method, params) => {
      calls.push({ method, params });
      if (method === "getAuthStatus") return auth();
      assert.equal(method, "configRequirements/read");
      assert.equal(params, undefined);
      return policy();
    },
  };
  const jsx = (type: unknown, props: unknown) => ({ type, props });
  const factories = { jsx, jsxs: jsx };
  const native = function NativePicker({ serviceTierOptionsLoading, onSelectServiceTier, triggerButton, onToggleMenuView }: any) {
    return { serviceTierOptionsLoading, onSelectServiceTier, triggerButton, onToggleMenuView };
  };
  const modules = {
    "app-shared-": { PCn: () => React, Agn: () => factories },
    "app-primary-": { Td: native, Ed: () => {}, Pd: () => {} },
  };
  let loadModules = async (key: keyof typeof modules) => modules[key];
  const window = {};
  const dependencies = {
    window, Date: class extends Date { static now() { return now; } },
    currentSessionRef: () => ({ session_id: "thread-12345678", host_id: "local" }),
    alunixaXSettings: () => settings,
    alunixaXBackendSettings: backendSettings,
    alunixaXBackendStatus: { status: "ok" },
    codexServiceTierState: { status: "ok", effectiveServiceTier: null },
    codexModelCatalogLoadedAt: 1,
    nativeHostClient: () => client,
    loadCodexAppModule: (key: keyof typeof modules) => loadModules(key),
    refreshCodexServiceTierBadges: () => {},
    sendAlunixaXDiagnostic: () => {},
  };
  const evaluate = (): {
    runtime: any; install: () => Promise<unknown>; ready: () => boolean; visible: () => boolean;
  } => runInNewContext(`(() => {
    ${source}
    return { runtime: codexNativeFastControlRuntime, install: installCodexNativeFastControls,
      ready: codexNativeFastControlClientReady, visible: codexNativeFastControlVisible };
  })()`, dependencies);
  const api = evaluate();
  return {
    ...api, settings, backendSettings, calls, factories, native, jsx,
    reinject: evaluate,
    setClient: (next: typeof client) => { client = next; },
    setAuth: (next: typeof auth) => { auth = next; },
    setPolicy: (next: typeof policy) => { policy = next; },
    setModuleLoader: (next: typeof loadModules) => { loadModules = next; },
    modules,
    advance: () => { now += 5001; },
  };
}

test("the installer verifies local API authentication and native requirements before patching JSX", async () => {
  const f = installerFixture();
  await f.install();
  assert.equal(f.ready(), true);
  assert.equal(typeof f.runtime.dispose, "function");
  assert.notEqual(f.factories.jsx, f.jsx);
  assert.deepEqual(f.calls.map((call) => call.method), ["getAuthStatus", "configRequirements/read"]);
  assert.equal((f.calls[0].params as any).includeToken, false);
  await f.install();
  assert.equal(f.calls.length, 2, "repeated scans retain the successful check for five seconds");
});

test("the installer preserves the fallback for official auth, prohibited Fast, malformed policy and read failures", async () => {
  for (const setup of [
    (f: ReturnType<typeof installerFixture>) => f.setAuth(async () => ({ authMethod: "chatgpt" })),
    (f: ReturnType<typeof installerFixture>) => f.setPolicy(async () => ({ requirements: { featureRequirements: { fast_mode: false } } })),
    (f: ReturnType<typeof installerFixture>) => f.setPolicy(async () => undefined),
    (f: ReturnType<typeof installerFixture>) => f.setPolicy(async () => { throw new Error("requirements unavailable"); }),
    (f: ReturnType<typeof installerFixture>) => f.setAuth(async () => { throw new Error("auth unavailable"); }),
  ]) {
    const f = installerFixture();
    setup(f);
    await f.install();
    assert.equal(f.ready(), false);
    assert.equal(f.runtime.dispose, null);
    assert.equal(f.factories.jsx, f.jsx);
    assert.equal(f.visible(), false);
  }
});

test("losing a native client invalidates cached authentication and immediately restores the fallback", async () => {
  const f = installerFixture();
  await f.install();
  f.runtime.activeControls.set({}, "local:thread-12345678");
  assert.equal(f.visible(), true);
  const patchedFactory = f.factories.jsx;
  f.setClient(null);
  assert.equal(f.ready(), false, "rendering fails closed before the next scan");
  assert.equal(f.visible(), false);
  await f.install();
  assert.equal(f.factories.jsx, f.jsx, "client loss must restore the native JSX factory");
  assert.notEqual(patchedFactory, f.factories.jsx);
  assert.equal(f.runtime.dispose, null);
  assert.equal(f.runtime.authMethod, null);
  assert.equal(f.runtime.client, null);
  assert.equal(f.runtime.pending, null);
});

test("a failed requirements refresh stops exposing an already installed native Fast control", async () => {
  const f = installerFixture();
  await f.install();
  f.runtime.activeControls.set({}, "local:thread-12345678");
  assert.equal(f.visible(), true);
  f.advance();
  f.setPolicy(async () => { throw new Error("requirements unavailable"); });
  await f.install();
  assert.equal(f.ready(), false);
  assert.equal(f.visible(), false);
  assert.equal(f.runtime.authMethod, null);
});

test("a replaced client cannot publish its late authentication result", async () => {
  const f = installerFixture();
  const auth = deferred<unknown>();
  f.setAuth(() => auth.promise);
  const old = f.install();
  f.setClient({ sendRequest: async () => ({ authMethod: "chatgpt" }) });
  await f.install();
  auth.resolve({ authMethod: "apikey" });
  await old;
  assert.equal(f.runtime.authMethod, "chatgpt");
  assert.equal(f.ready(), false);
  assert.equal(f.factories.jsx, f.jsx);
});

test("disable and reenable starts a fresh read without letting the old completion clear or overwrite it", async () => {
  for (const outcome of ["success", "failure"]) {
    const f = installerFixture();
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    f.setAuth(() => first.promise);
    const old = f.install();
    f.settings.serviceTierControls = false;
    await f.install();
    f.settings.serviceTierControls = true;
    f.setAuth(() => second.promise);
    const fresh = f.install();
    const pending = f.runtime.pending;
    if (outcome === "success") first.resolve({ authMethod: "apikey" });
    else first.reject(new Error("old authentication failed"));
    await old;
    assert.equal(f.runtime.pending, pending);
    assert.equal(f.runtime.authMethod, null);
    second.resolve({ authMethod: "apikey" });
    await fresh;
    assert.equal(f.ready(), true);
    assert.equal(f.runtime.pending, null);
  }
});

test("a disable during module loading prevents a delayed JSX patch from being installed", async () => {
  const f = installerFixture();
  const modules = deferred<void>();
  const loading = deferred<void>();
  f.setModuleLoader(async (key) => { loading.resolve(); await modules.promise; return f.modules[key]; });
  const pending = f.install();
  await loading.promise;
  f.settings.serviceTierControls = false;
  await f.install();
  modules.resolve();
  await pending;
  assert.equal(f.runtime.dispose, null);
  assert.equal(f.factories.jsx, f.jsx);
  assert.equal(f.ready(), false);
});

test("reinjection invalidates outstanding auth reads while an installed bridge remains reversible", async () => {
  const f = installerFixture();
  const auth = deferred<unknown>();
  f.setAuth(() => auth.promise);
  const old = f.install();
  const fresh = f.reinject();
  f.setAuth(async () => ({ authMethod: "chatgpt" }));
  await fresh.install();
  auth.resolve({ authMethod: "apikey" });
  await old;
  assert.equal(f.runtime.authMethod, "chatgpt");
  f.advance();
  f.setAuth(async () => ({ authMethod: "apikey" }));
  await fresh.install();
  assert.notEqual(f.factories.jsx, f.jsx);
  f.backendSettings.codexAppVersion = "unknown";
  await fresh.install();
  assert.equal(f.runtime.dispose, null);
  assert.equal(f.factories.jsx, f.jsx);
});
