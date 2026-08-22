import assert from "node:assert";
import fs from "node:fs";
import { describe, it } from "node:test";
import type { RelayProfile } from "./App.tsx";
import {
  buildModelWindows,
  modelWindowRowsFromProfile,
  modelWindowsMapToText,
  modelWindowsTextToMap,
  serializeModelWindowRows,
  mergeModelWindowRows,
} from "./model-windows.ts";

// 类型检查：确保 RelayProfile 包含 modelWindows 和 modelVlm 字段
const _profileTypeCheck: RelayProfile = {
  id: "test",
  name: "",
  model: "",
  baseUrl: "",
  upstreamBaseUrl: "",
  apiKey: "",
  protocol: "responses",
  relayMode: "official",
  officialMixApiKey: false,
  testModel: "",
  configContents: "",
  authContents: "",
  useCommonConfig: true,
  contextSelection: { mcpServers: [], skills: [], plugins: [] },
  contextSelectionInitialized: true,
  contextWindow: "",
  autoCompactLimit: "",
  autoCompactEnabled: false,
  modelList: "",
  modelWindows: "",
  modelVlm: "",
  modelReasoningEfforts: {},
  lastUsedModel: "",
  vlmApiKey: "",
  vlmModel: "",
  vlmBaseUrl: "",
  userAgent: "",
  customModels: [],
  defaultCustomModelId: "",
};

void _profileTypeCheck;

describe("model-windows helpers", () => {
  it("供应商详情只在持久化或原子切换成功后关闭", () => {
    const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    assert.match(source, /const saveSettingsValue = async[\s\S]+?Promise<boolean>/);
    assert.match(source, /const saved = isActive && form\.relayProfilesEnabled/);
    assert.match(source, /await actions\.switchRelayProfile\(next, form\.activeRelayId\)/);
    assert.match(source, /if \(!saved\) return;/);
    assert.match(source, /重启 Codex 也不会应用；请返回列表开启总开关后再次保存。/);
    assert.match(source, /供应商配置已保存。/);
    assert.doesNotMatch(source, /await actions\.saveRelayFile\(\s*"config"/);
  });

  it("退出登录始终可见且思考等级保存显示专用结果", () => {
    const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
    const logoutButtonIndex = source.indexOf("onClick={() => void actions.logoutChatGpt()}");
    const pendingLoginControlsIndex = source.indexOf("{pendingLogin ? (", logoutButtonIndex);
    const logoutAction = source.slice(
      source.indexOf("const logoutChatGpt = async () =>"),
      source.indexOf("const runOfficialRemoteSnapshotCommand", source.indexOf("const logoutChatGpt = async () =>")),
    );

    assert.match(source, /<Button disabled=\{busy\} onClick=\{\(\) => void actions\.logoutChatGpt\(\)\}/);
    assert.doesNotMatch(source, /\{signedIn \? \(\s*<Button[^>]+logoutChatGpt/);
    assert.notStrictEqual(logoutButtonIndex, -1);
    assert.ok(pendingLoginControlsIndex > logoutButtonIndex);
    assert.doesNotMatch(logoutAction, /if \(officialRemoteBusy \|\| pendingChatGptLogin\) return;/);
    assert.match(logoutAction, /if \(pendingChatGptLogin\) \{[\s\S]+?chatgpt_web_login_cancel[\s\S]+?setPendingChatGptLogin\(null\)/);
    assert.match(source, /const saveReasoningEfforts = async \(\) =>/);
    assert.match(source, /saveSettingsValue\(normalized, true, true\)/);
    assert.match(source, /思考等级保存成功。/);
    assert.match(source, /思考等级保存失败，请检查错误后重试。/);
  });

  it("设置保存按顺序执行且失败响应不会覆盖当前编辑快照", () => {
    const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    assert.match(source, /const settingsSaveQueueRef = useRef\(Promise\.resolve\(\)\)/);
    assert.match(source, /const settingsSaveRequestRef = useRef\(0\)/);
    assert.match(source, /const requestId = \+\+settingsSaveRequestRef\.current/);
    assert.match(
      source,
      /isSuccessStatus\(result\.status\) && requestId === settingsSaveRequestRef\.current/,
    );
    assert.match(source, /if \(result && isSuccessStatus\(result\.status\)\)/);
    assert.match(source, /if \(result && !silent\) showResultNotice\(t\("设置已加载"\), result\)/);
  });

  it("共享终端释放时间使用 0 到 5 分钟的持久化滑块", () => {
    const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    assert.match(source, /codexAppSharedTerminalRetentionMinutes: 2/);
    assert.match(source, /type="range"/);
    assert.match(source, /min=\{0\}/);
    assert.match(source, /max=\{5\}/);
    assert.match(source, /step=\{1\}/);
    assert.match(source, /form\.codexAppSharedTerminalRetentionMinutes === 0/);
    assert.match(source, /t\("立即释放"\)/);
    assert.match(source, /setPersistedSharedTerminalRetention/);
    assert.match(source, /saveSettingsValue\(next, true\)/);
  });

  it("Responses ID 协商默认关闭并作为 Agent 能力即时保存", () => {
    const source = fs.readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

    assert.match(source, /codexAppResponsesIdNegotiation: false/);
    assert.match(source, /title=\{t\("Responses ID 自动协商"\)\}/);
    assert.match(source, /checked=\{form\.codexAppResponsesIdNegotiation\}/);
    assert.match(source, /setPersistedEnhanceFlag\("codexAppResponsesIdNegotiation", value\)/);
    assert.match(source, /invalid_id_prefix/);
  });

  it("modelWindowsMapToText 按 modelList 行顺序输出窗口文本", () => {
    assert.strictEqual(
      modelWindowsMapToText("a\nb\nc", '{"a":"1M","c":"200K"}'),
      "1M\n\n200K",
    );
  });

  it("modelWindowsMapToText 对非法 JSON 返回空字符串", () => {
    assert.strictEqual(modelWindowsMapToText("a\nb", "not-json"), "");
  });

  it("modelWindowsTextToMap 按行组装 model_windows map", () => {
    assert.strictEqual(
      modelWindowsTextToMap("a\nb\nc", "1M\n\n200K"),
      '{"a":"1M","c":"200K"}',
    );
  });

  it("modelWindowsTextToMap 对没有对应窗口的模型不写入 map", () => {
    assert.strictEqual(
      modelWindowsTextToMap("a\nb", "1M"),
      '{"a":"1M"}',
    );
  });

  it("buildModelWindows 行数一致时返回 modelWindows JSON", () => {
    const result = buildModelWindows("deepseek-v4-flash\ndeepseek-v4-pro", "1M\n");
    assert.strictEqual(result.ok, true);
    if (result.ok) {
      assert.strictEqual(result.modelWindows, '{"deepseek-v4-flash":"1M"}');
    }
  });

  it("buildModelWindows 行数不一致时返回错误", () => {
    const result = buildModelWindows("a\nb", "1M");
    assert.strictEqual(result.ok, false);
    if (!result.ok) {
      assert.ok(result.error.includes("2"));
      assert.ok(result.error.includes("1"));
    }
  });

  it("modelWindowRowsFromProfile 把模型和窗口合成同一组行", () => {
    assert.deepStrictEqual(
      modelWindowRowsFromProfile("a\nb\nc", '{"a":"1M","c":"200K"}'),
      [
        { model: "a", window: "1M", imageHandling: "send-as-is" },
        { model: "b", window: "", imageHandling: "send-as-is" },
        { model: "c", window: "200K", imageHandling: "send-as-is" },
      ],
    );
  });

  it("modelWindowRowsFromProfile 解析 modelVlm 标记", () => {
    assert.deepStrictEqual(
      modelWindowRowsFromProfile("a\nb\nc", '{}', '{"a":"vlm","b":"strip"}'),
      [
        { model: "a", window: "", imageHandling: "vlm" },
        { model: "b", window: "", imageHandling: "strip" },
        { model: "c", window: "", imageHandling: "send-as-is" },
      ],
    );
  });

  it("serializeModelWindowRows 从行控件生成 modelList、modelWindows 和 modelVlm", () => {
    assert.deepStrictEqual(
      serializeModelWindowRows([
        { model: "a", window: "1M", imageHandling: "vlm" },
        { model: "", window: "400K", imageHandling: "send-as-is" },
        { model: "b", window: "", imageHandling: "send-as-is" },
      ]),
      {
        modelList: "a\nb",
        modelWindows: '{"a":"1M"}',
        modelVlm: '{"a":"vlm"}',
      },
    );
  });

  it("mergeModelWindowRows 追加上游模型时跳过已有模型并保留窗口和图片处理", () => {
    assert.deepStrictEqual(
      mergeModelWindowRows(
        [
          { model: "deepseek-v4-flash", window: "1M", imageHandling: "vlm" },
          { model: "  ", window: "", imageHandling: "send-as-is" },
        ],
        [
          { model: "deepseek-v4-flash", window: "", imageHandling: "send-as-is" },
          { model: "deepseek-v4-pro", window: "", imageHandling: "vlm" },
          { model: " deepseek-v4-pro ", window: "200K", imageHandling: "send-as-is" },
        ],
      ),
      [
        { model: "deepseek-v4-flash", window: "1M", imageHandling: "vlm" },
        { model: "deepseek-v4-pro", window: "", imageHandling: "vlm" },
      ],
    );
  });
});
