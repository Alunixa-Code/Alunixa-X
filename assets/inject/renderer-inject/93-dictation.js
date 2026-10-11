  // API Key 听写使用独立的 ASR 服务。新版原生 capability / app-host RPC 是只读的，
  // 因此入口与录音由 CPP 管理，识别结果通过原生编辑器事务回填，保持草稿和附件。
  window.__alunixaXDictationRuntime?.dispose?.();
  const alunixaXDictation = {
    phase: "idle", revision: 0, target: null, stream: null, recorder: null,
    chunks: [], blob: null, text: "", error: "", action: "insert", startedAt: 0,
    controller: null, timer: null, status: null, statusAt: 0, statusPromise: null,
    nativeApi: null, nativeApiPromise: null, pendingSend: false,
  };
  const alunixaXDictationMaxBytes = 25 * 1024 * 1024;
  registerCodexPlusExtensionSelector('[data-alunixa-x-ext="builtin-dictation"]');

  function alunixaXDictationEnabled() {
    return alunixaXBackendSettingsLoaded && alunixaXBackendSettings.enhancementsEnabled !== false
      && alunixaXBackendSettings.dictation?.enabled === true;
  }

  function alunixaXDictationEditor(scope) {
    return [...scope.querySelectorAll('.ProseMirror[contenteditable="true"], textarea:not(:disabled):not([readonly]), [role="textbox"][contenteditable="true"]')]
      .find((node) => visibleElement(node) && !isExtensionUiNode(node) && !node.closest('[inert], [aria-hidden="true"]')) || null;
  }

  function alunixaXDictationScope(footer) {
    let scope = footer?.parentElement;
    while (scope && scope !== document.body) {
      if (alunixaXDictationEditor(scope)) return scope;
      if (scope.matches?.('[data-codex-composer-root], [data-composer-surface-variant], form')) break;
      scope = scope.parentElement;
    }
    return null;
  }

  function alunixaXDictationTargetEditor() {
    const target = alunixaXDictation.target;
    if (!target || window.location.href !== target.href) return null;
    const editor = [...document.querySelectorAll('[data-alunixa-x-dictation-target]')]
      .find((node) => node.dataset.alunixaXDictationTarget === target.id && visibleElement(node));
    if (editor) return editor;
    const root = [...document.querySelectorAll('[data-alunixa-x-dictation-root]')]
      .find((node) => node.dataset.alunixaXDictationRoot === target.id && visibleElement(node));
    return root ? alunixaXDictationEditor(root) : null;
  }

  async function loadCodexPlusDictationNativeApi() {
    if (alunixaXDictation.nativeApiPromise) return alunixaXDictation.nativeApiPromise;
    alunixaXDictation.nativeApiPromise = loadOptionalCodexAppModule("app-initial-").then((module) => {
      // 构建间压缩导出名会变化，只按能力识别函数；从不写 ESM namespace。
      const functions = Object.values(module || {}).filter((value) => typeof value === "function");
      const append = functions.find((fn) => {
        const source = String(fn);
        return source.length < 3000 && source.includes(".composerId===") && source.includes(".appendPromptText")
          && source.includes(".isDictationInProgress") && source.includes("[readonly]") && source.includes(".focus()");
      });
      const context = functions.find((fn) => {
        const source = String(fn);
        return source.length < 3000 && source.includes("document.activeElement?.closest")
          && source.includes("[data-codex-composer-root]") && source.includes("composerId:") && source.includes("root:");
      });
      alunixaXDictation.nativeApi = append && context ? { append, context } : null;
      return alunixaXDictation.nativeApi;
    }).catch(() => null);
    return alunixaXDictation.nativeApiPromise;
  }

  function alunixaXDictationView(editor) {
    const view = editor?.pmViewDesc?.view;
    return view && !view.isDestroyed && view.dom === editor && view.state?.tr && typeof view.dispatch === "function" ? view : null;
  }

  function alunixaXInsertDictation(editor, transcript, nativeApi = alunixaXDictation.nativeApi, composerId = alunixaXDictation.target?.composerId) {
    const text = String(transcript || "").trim();
    if (!text || !editor?.isConnected || editor.matches?.(':disabled, [readonly], [contenteditable="false"]')
        || editor.closest?.('[inert], [aria-hidden="true"]')) return false;
    editor.focus();
    if (nativeApi && composerId) {
      const context = nativeApi.context();
      if (context?.composerId !== composerId || !context.root?.contains(editor)) return false;
      return nativeApi.append(composerId, text) === true;
    }
    const view = alunixaXDictationView(editor);
    if (view) {
      // 用原生事务更新 React/ProseMirror 状态；不能直接改 innerHTML/textContent。
      const { from, to } = view.state.selection;
      const before = view.state.doc.textBetween(Math.max(0, from - 1), from, "\n");
      const prefix = before && !/\s$/.test(before) ? " " : "";
      view.dispatch(view.state.tr.insertText(prefix + text, from, to).scrollIntoView());
      return true;
    }
    if (editor instanceof HTMLTextAreaElement) {
      const from = editor.selectionStart ?? editor.value.length;
      const to = editor.selectionEnd ?? from;
      const prefix = from > 0 && !/\s/.test(editor.value[from - 1]) ? " " : "";
      const inserted = prefix + text;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      if (!setter) return false;
      setter.call(editor, editor.value.slice(0, from) + inserted + editor.value.slice(to));
      editor.setSelectionRange(from + inserted.length, from + inserted.length);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
    // 老版本的 contenteditable 交给浏览器编辑命令，失败时保留可复制的识别结果。
    const selection = window.getSelection?.();
    if (document.activeElement !== editor || !selection?.anchorNode || !editor.contains(selection.anchorNode)) return false;
    return document.execCommand("insertText", false, text) === true;
  }

  function alunixaXDictationSendButton(editor) {
    let scope = editor.parentElement;
    while (scope && scope !== document.body) {
      const button = [...scope.querySelectorAll('button')].find((node) => {
        if (isExtensionUiNode(node) || !visibleElement(node) || node.disabled || node.getAttribute("aria-disabled") === "true") return false;
        const label = `${node.getAttribute("aria-label") || ""} ${node.getAttribute("title") || ""}`.trim();
        return /^(?:Send|Send message|Send prompt|Submit|发送|发送消息|发送提示|提交)(?:\s|\(|（|$)/i.test(label)
          || node.getAttribute("data-testid") === "send-button" || node.getAttribute("data-action") === "send";
      });
      if (button) return button;
      if (scope.hasAttribute("data-codex-composer-root") || scope.hasAttribute("data-composer-surface-variant") || scope.tagName === "FORM") break;
      scope = scope.parentElement;
    }
    return null;
  }

  function alunixaXDictationStopTracks() {
    alunixaXDictation.stream?.getTracks().forEach((track) => track.stop());
    alunixaXDictation.stream = null;
    clearInterval(alunixaXDictation.timer);
    alunixaXDictation.timer = null;
  }

  function cancelCodexPlusDictation() {
    ++alunixaXDictation.revision;
    alunixaXDictation.controller?.abort();
    alunixaXDictation.controller = null;
    const recorder = alunixaXDictation.recorder;
    alunixaXDictation.recorder = null;
    if (recorder?.state !== "inactive") { try { recorder?.stop(); } catch {} }
    alunixaXDictationStopTracks();
    document.querySelectorAll('[data-alunixa-x-dictation-target], [data-alunixa-x-dictation-root]').forEach((node) => {
      delete node.dataset.alunixaXDictationTarget; delete node.dataset.alunixaXDictationRoot;
    });
    Object.assign(alunixaXDictation, { phase: "idle", target: null, chunks: [], blob: null, text: "", error: "", pendingSend: false });
    renderCodexPlusDictation();
  }

  async function loadCodexPlusDictationStatus(force = false) {
    if (alunixaXDictation.statusPromise) return alunixaXDictation.statusPromise;
    if (!force && Date.now() - alunixaXDictation.statusAt < 5000) return alunixaXDictation.status;
    alunixaXDictation.statusPromise = postJson("/dictation/status", {}).then((status) => {
      alunixaXDictation.status = status;
      alunixaXDictation.statusAt = Date.now();
      return status;
    }).finally(() => { alunixaXDictation.statusPromise = null; });
    return alunixaXDictation.statusPromise;
  }

  async function startCodexPlusDictation(footer) {
    if (!alunixaXDictationEnabled() || alunixaXDictation.phase !== "idle") return;
    const editor = alunixaXDictationScope(footer) && alunixaXDictationEditor(alunixaXDictationScope(footer));
    if (!editor) { showToast("无法找到可编辑的 Codex 输入框", null); return; }
    if (footer.getAttribute("data-dictation-view")) { showToast("请先结束原生语音输入", null); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder !== "function") {
      showToast("当前环境不支持麦克风录音", null); return;
    }
    const revision = ++alunixaXDictation.revision;
    const id = crypto.randomUUID();
    editor.dataset.alunixaXDictationTarget = id;
    Object.assign(alunixaXDictation, {
      phase: "requesting", target: { id, href: window.location.href },
      error: "", text: "", chunks: [], blob: null, action: "insert",
    });
    installCodexPlusDictation();
    try {
      const nativeApi = await loadCodexPlusDictationNativeApi();
      if (revision !== alunixaXDictation.revision) return;
      if (!alunixaXDictationTargetEditor()) throw new Error("输入框或会话已变化，请返回目标会话后重录");
      editor.focus();
      const context = nativeApi?.context();
      if (context?.root?.contains(editor) && context.composerId) {
        alunixaXDictation.target.composerId = context.composerId;
        context.root.dataset.alunixaXDictationRoot = id;
      }
      const status = await loadCodexPlusDictationStatus(true);
      if (revision !== alunixaXDictation.revision) return;
      if (!alunixaXDictationEnabled()) { cancelCodexPlusDictation(); return; }
      if (!status?.enabled || !status?.configured || !status?.helperToken) throw new Error(status?.message || "请先在管理工具中配置并启用语音服务");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      if (revision !== alunixaXDictation.revision) {
        stream.getTracks().forEach((track) => track.stop()); return;
      }
      if (!alunixaXDictationEnabled()) {
        stream.getTracks().forEach((track) => track.stop()); cancelCodexPlusDictation(); return;
      }
      alunixaXDictation.stream = stream;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"]
        .find((type) => typeof MediaRecorder.isTypeSupported === "function" && MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      alunixaXDictation.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (revision !== alunixaXDictation.revision || !event.data?.size) return;
        alunixaXDictation.chunks.push(event.data);
        if (alunixaXDictation.chunks.reduce((sum, chunk) => sum + chunk.size, 0) > alunixaXDictationMaxBytes) {
          alunixaXDictation.error = "录音超过 25 MiB，请缩短后重录";
          stopCodexPlusDictation("discard");
        }
      };
      recorder.onerror = () => {
        if (revision !== alunixaXDictation.revision) return;
        alunixaXDictation.error = "录音失败，请检查麦克风后重录";
        stopCodexPlusDictation("discard");
      };
      recorder.onstop = () => {
        if (revision !== alunixaXDictation.revision) return;
        alunixaXDictationStopTracks();
        alunixaXDictation.recorder = null;
        const blob = new Blob(alunixaXDictation.chunks, { type: recorder.mimeType || "audio/webm" });
        alunixaXDictation.chunks = [];
        if (alunixaXDictation.action === "discard" || blob.size > alunixaXDictationMaxBytes) {
          alunixaXDictation.phase = "error"; renderCodexPlusDictation(); return;
        }
        if (!blob.size || Date.now() - alunixaXDictation.startedAt < 250) { cancelCodexPlusDictation(); return; }
        alunixaXDictation.blob = blob;
        void transcribeCodexPlusDictation();
      };
      recorder.start(1000);
      alunixaXDictation.phase = "recording";
      alunixaXDictation.startedAt = Date.now();
      alunixaXDictation.timer = setInterval(() => {
        if (Date.now() - alunixaXDictation.startedAt >= 595000) stopCodexPlusDictation("insert");
        renderCodexPlusDictation();
      }, 1000);
      renderCodexPlusDictation();
    } catch (error) {
      if (revision !== alunixaXDictation.revision) return;
      alunixaXDictationStopTracks();
      alunixaXDictation.phase = "error";
      alunixaXDictation.error = ["NotAllowedError", "SecurityError"].includes(error?.name)
        ? "麦克风权限被拒绝，请在系统设置中允许 Codex 使用麦克风后重录"
        : error?.name === "NotFoundError" ? "未找到麦克风" : error?.message || "无法开始录音";
      renderCodexPlusDictation();
    }
  }

  function stopCodexPlusDictation(action) {
    alunixaXDictation.action = action;
    if (alunixaXDictation.phase === "transcribing") { renderCodexPlusDictation(); return; }
    if (alunixaXDictation.phase !== "recording") return;
    alunixaXDictation.phase = "transcribing";
    clearInterval(alunixaXDictation.timer);
    try { alunixaXDictation.recorder.stop(); }
    catch { alunixaXDictationStopTracks(); alunixaXDictation.phase = "error"; alunixaXDictation.error = "无法结束录音，请重录"; }
    renderCodexPlusDictation();
  }

  async function finishCodexPlusDictation() {
    if (!alunixaXDictationEnabled()) { cancelCodexPlusDictation(); return; }
    const editor = alunixaXDictationTargetEditor();
    if (!editor || !alunixaXInsertDictation(editor, alunixaXDictation.text)) {
      alunixaXDictation.phase = "result";
      alunixaXDictation.error = "输入框或会话已变化，请复制识别结果到目标输入框";
      renderCodexPlusDictation(); return;
    }
    const send = alunixaXDictation.action === "send";
    const target = { ...alunixaXDictation.target };
    cancelCodexPlusDictation();
    if (send) {
      const revision = alunixaXDictation.revision;
      alunixaXDictation.pendingSend = true;
      // 给原生状态一个渲染周期，再点击它自己的发送按钮；找不到时保留已插入的草稿。
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (revision !== alunixaXDictation.revision) return;
      alunixaXDictation.pendingSend = false;
      if (!alunixaXDictationEnabled() || window.location.href !== target.href) return;
      const context = alunixaXDictation.nativeApi?.context();
      const currentEditor = target.composerId && context?.composerId === target.composerId
        ? alunixaXDictationEditor(context.root) : editor.isConnected && !target.composerId ? editor : null;
      if (!currentEditor) return;
      const button = alunixaXDictationSendButton(currentEditor);
      if (button) button.click();
      else showToast("识别结果已插入，请点击发送", null);
    }
  }

  async function alunixaXDictationAudioBase64(blob, signal) {
    if (blob.size > alunixaXDictationMaxBytes) throw new Error("录音超过 25 MiB，请缩短后重录");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let encoded = "";
    // 按 3 字节对齐分段编码，避免一次展开大录音耗尽调用栈；让取消事件有机会执行。
    for (let offset = 0; offset < bytes.length; offset += 49152) {
      if (signal.aborted) throw new DOMException("转写已取消", "AbortError");
      encoded += btoa(String.fromCharCode(...bytes.subarray(offset, offset + 49152)));
      if (offset && offset % (49152 * 8) === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    return encoded;
  }

  // SenseVoice 接收 16 kHz/单声道 PCM WAV；MediaRecorder 在 Chromium 中通常只提供 WebM/Opus，
  // 因此只在选择本地 provider 时通过浏览器音频解码器做一次无损 PCM 转换。
  async function alunixaXDictationSenseVoiceWav(blob, signal) {
    if (signal.aborted) throw new DOMException("转写已取消", "AbortError");
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    const OfflineContextCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!AudioContextCtor || !OfflineContextCtor) throw new Error("当前环境无法转换本地 SenseVoice 音频");
    const context = new AudioContextCtor();
    try {
      const decoded = await context.decodeAudioData(await blob.arrayBuffer());
      if (signal.aborted) throw new DOMException("转写已取消", "AbortError");
      const frames = Math.max(1, Math.ceil(decoded.duration * 16000));
      const offline = new OfflineContextCtor(1, frames, 16000);
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      const rendered = await offline.startRendering();
      const samples = rendered.getChannelData(0);
      const bytes = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(bytes);
      const write = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i)); };
      write(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true); write(8, "WAVE");
      write(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
      view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
      write(36, "data"); view.setUint32(40, samples.length * 2, true);
      for (let i = 0; i < samples.length; i++) {
        const sample = Math.max(-1, Math.min(1, samples[i]));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      }
      return new Blob([bytes], { type: "audio/wav" });
    } finally {
      void context.close?.();
    }
  }

  async function transcribeCodexPlusDictation() {
    if (!alunixaXDictationEnabled()) { cancelCodexPlusDictation(); return; }
    if (!alunixaXDictation.blob) return;
    const revision = ++alunixaXDictation.revision;
    const controller = new AbortController();
    alunixaXDictation.controller = controller;
    alunixaXDictation.phase = "transcribing";
    alunixaXDictation.error = "";
    renderCodexPlusDictation();
    let cancelRequest = null;
    try {
      const status = await loadCodexPlusDictationStatus(true);
      if (revision !== alunixaXDictation.revision) return;
      if (!status?.enabled || !status?.configured || !status?.helperToken) throw new Error(status?.message || "语音服务尚未配置");
      const requestId = crypto.randomUUID();
      let requestStarted = false;
      cancelRequest = () => {
        if (requestStarted) void postJson("/dictation/cancel", { requestId, helperToken: status.helperToken }).catch(() => {});
      };
      controller.signal.addEventListener("abort", cancelRequest, { once: true });
      const uploadBlob = status.provider === "sensevoice"
        ? await alunixaXDictationSenseVoiceWav(alunixaXDictation.blob, controller.signal)
        : alunixaXDictation.blob;
      const audioBase64 = await alunixaXDictationAudioBase64(uploadBlob, controller.signal);
      if (revision !== alunixaXDictation.revision || controller.signal.aborted) return;
      if (!alunixaXDictationEnabled()) { cancelCodexPlusDictation(); return; }
      const extension = uploadBlob.type.includes("wav") ? "wav" : uploadBlob.type.includes("mp4") ? "m4a" : "webm";
      requestStarted = true;
      // app:// 的 CSP 不允许 renderer 直接 fetch localhost；音频经既有特权桥接交给 Rust。
      const result = await postJson("/dictation/transcribe", {
        requestId, audioBase64, mimeType: uploadBlob.type || "audio/webm",
        filename: `dictation.${extension}`, helperToken: status.helperToken,
      });
      controller.signal.removeEventListener("abort", cancelRequest);
      cancelRequest = null;
      if (revision !== alunixaXDictation.revision) return;
      if (result?.status === "failed" || result?.status === "cancelled") throw new Error(result?.message || "语音转写失败");
      if (typeof result?.text !== "string") throw new Error("语音服务没有返回 text 字段");
      alunixaXDictation.text = result.text.trim();
      if (!alunixaXDictation.text) { cancelCodexPlusDictation(); showToast("未识别到文字，请重录", null); return; }
      await finishCodexPlusDictation();
    } catch (error) {
      if (revision !== alunixaXDictation.revision) return;
      alunixaXDictation.phase = "error";
      alunixaXDictation.error = error?.name === "AbortError" ? "转写已取消" : error?.message || "语音转写失败";
      renderCodexPlusDictation();
    } finally {
      if (cancelRequest) controller.signal.removeEventListener("abort", cancelRequest);
      if (revision === alunixaXDictation.revision) alunixaXDictation.controller = null;
    }
  }

  function alunixaXDictationControl(action, label, disabled = false) {
    const button = document.createElement("button");
    button.type = "button"; button.textContent = label; button.dataset.dictationAction = action;
    button.disabled = disabled;
    return button;
  }

  function renderCodexPlusDictation() {
    const state = alunixaXDictation;
    document.querySelectorAll('[data-alunixa-x-ext="builtin-dictation"][data-dictation-controls]').forEach((root) => {
      const active = state.phase !== "idle" && (root.dataset.dictationTarget === state.target?.id || root.dataset.floating === "true");
      const seconds = Math.floor((Date.now() - state.startedAt) / 1000);
      const recordingLabel = `● 录音 ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
      const key = active ? `${state.phase}:${state.action}:${state.error}:${state.text}` : "idle";
      if (root.dataset.renderKey === key) {
        // 计时只改文本，不能每秒销毁按钮，否则键盘焦点和进行中的点击会丢失。
        if (active && state.phase === "recording") root.querySelector('[role="status"]').textContent = recordingLabel;
        return;
      }
      root.dataset.renderKey = key; root.replaceChildren();
      if (!active) { root.append(alunixaXDictationControl("start", "语音输入", state.phase !== "idle")); return; }
      const status = document.createElement("span"); status.setAttribute("role", "status");
      if (state.phase === "recording") status.setAttribute("aria-live", "off");
      status.textContent = state.phase === "requesting" ? "正在请求麦克风…"
        : state.phase === "recording" ? recordingLabel
        : state.phase === "transcribing" ? "正在转写…" : state.error;
      root.append(status);
      if (state.phase === "recording") {
        root.append(alunixaXDictationControl("insert", "停止并插入"), alunixaXDictationControl("send", "停止并发送"));
      } else if (state.phase === "transcribing") {
        root.append(alunixaXDictationControl("send", "完成后发送", state.action === "send"));
      } else if (state.phase === "error") {
        if (state.blob) root.append(alunixaXDictationControl("retry", "重试转写"));
        root.append(alunixaXDictationControl("rerecord", "重录"));
      } else if (state.phase === "result") {
        const text = document.createElement("textarea"); text.readOnly = true; text.value = state.text; text.setAttribute("aria-label", "语音识别结果");
        root.append(text, alunixaXDictationControl("copy", "复制文字"));
      }
      root.append(alunixaXDictationControl("cancel", state.phase === "result" ? "关闭" : "取消"));
    });
    const floating = document.getElementById("alunixa-x-dictation-recovery");
    if (state.phase === "idle") floating?.remove();
    else if (!alunixaXDictationTargetEditor() && !floating) {
      const root = createCodexPlusDictationControls();
      root.id = "alunixa-x-dictation-recovery"; root.dataset.floating = "true";
      document.body.append(root); renderCodexPlusDictation();
    }
  }

  function createCodexPlusDictationControls() {
    const root = document.createElement("div");
    root.dataset.alunixaXExt = "builtin-dictation"; root.dataset.dictationControls = "true";
    root.className = "alunixa-x-dictation-controls";
    root.addEventListener("pointerdown", (event) => { if (event.target.closest("button")) event.preventDefault(); });
    root.addEventListener("click", (event) => {
      const action = event.target.closest('[data-dictation-action]')?.dataset.dictationAction;
      if (!action) return;
      event.preventDefault(); event.stopPropagation();
      if (action === "start") void startCodexPlusDictation(root.closest(".composer-footer, [data-composer-footer-responsive]"));
      else if (action === "cancel") cancelCodexPlusDictation();
      else if (action === "retry") void transcribeCodexPlusDictation();
      else if (action === "rerecord") {
        const footer = alunixaXDictationTargetEditor()?.closest('[data-composer-surface-variant], form')?.querySelector('.composer-footer, [data-composer-footer-responsive]')
          || root.closest(".composer-footer, [data-composer-footer-responsive]");
        cancelCodexPlusDictation();
        if (footer) void startCodexPlusDictation(footer);
        else showToast("请返回目标会话后重新录音", null);
      } else if (action === "copy") {
        if (!navigator.clipboard?.writeText) { showToast("请选中识别结果手动复制", null); return; }
        void navigator.clipboard.writeText(alunixaXDictation.text)
          .then(() => showToast("已复制识别结果", null)).catch(() => showToast("复制失败，请选中识别结果手动复制", null));
      } else stopCodexPlusDictation(action);
    });
    return root;
  }

  function installCodexPlusDictation() {
    if (!alunixaXDictationEnabled()) {
      if (alunixaXDictation.phase !== "idle" || alunixaXDictation.pendingSend) cancelCodexPlusDictation();
      document.querySelectorAll('[data-alunixa-x-ext="builtin-dictation"]').forEach((node) => node.remove());
      return;
    }
    if (!document.getElementById("alunixa-x-dictation-style")) {
      const style = document.createElement("style"); style.id = "alunixa-x-dictation-style";
      style.dataset.alunixaXExt = "builtin-dictation";
      style.textContent = `.alunixa-x-dictation-controls{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-inline:6px;font-size:12px;max-width:100%}
        .alunixa-x-dictation-controls button{border:1px solid color-mix(in srgb,currentColor 20%,transparent);border-radius:8px;padding:5px 8px;background:transparent;color:inherit;cursor:pointer;white-space:nowrap}
        .alunixa-x-dictation-controls button:disabled{opacity:.5;cursor:default}.alunixa-x-dictation-controls button:focus-visible{outline:2px solid currentColor;outline-offset:2px}
        #alunixa-x-dictation-recovery{position:fixed;bottom:24px;right:24px;z-index:2147483000;padding:12px;border-radius:12px;background:var(--background,#252525);color:var(--foreground,#eee);box-shadow:0 4px 24px #0006;max-width:480px}
        #alunixa-x-dictation-recovery textarea{width:100%;min-height:80px;color:inherit;background:transparent}`;
      document.head.append(style);
    }
    document.querySelectorAll(".composer-footer, [data-composer-footer-responsive]").forEach((footer) => {
      if (!visibleElement(footer) || isExtensionUiNode(footer)) return;
      const scope = alunixaXDictationScope(footer);
      const editor = scope && alunixaXDictationEditor(scope);
      if (!editor) return;
      let controls = footer.querySelector('[data-dictation-controls]');
      if (!controls) { controls = createCodexPlusDictationControls(); footer.append(controls); }
      const target = editor.dataset.alunixaXDictationTarget || editor.closest('[data-alunixa-x-dictation-root]')?.dataset.alunixaXDictationRoot || "";
      if (controls.dataset.dictationTarget !== target) { controls.dataset.dictationTarget = target; delete controls.dataset.renderKey; }
    });
    renderCodexPlusDictation();
  }

  const alunixaXDictationKeyHandler = (event) => {
    if (event.key === "Escape" && (alunixaXDictation.phase !== "idle" || alunixaXDictation.pendingSend)) {
      event.preventDefault(); event.stopImmediatePropagation(); cancelCodexPlusDictation();
      return;
    }
    const editor = alunixaXDictationTargetEditor();
    if (event.key === "Enter" && !event.isComposing && !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey
        && editor && (document.activeElement === editor || editor.contains?.(document.activeElement))
        && ["requesting", "recording", "transcribing"].includes(alunixaXDictation.phase)) {
      // 在录音期间，Enter 先结束转写再发送，不能让原生输入框先提交旧草稿。
      event.preventDefault(); event.stopImmediatePropagation();
      if (alunixaXDictation.phase !== "requesting") stopCodexPlusDictation("send");
    }
  };
  document.addEventListener("keydown", alunixaXDictationKeyHandler, true);
  const alunixaXDictationDispose = () => {
    cancelCodexPlusDictation();
    document.removeEventListener("keydown", alunixaXDictationKeyHandler, true);
    document.querySelectorAll('[data-alunixa-x-ext="builtin-dictation"]').forEach((node) => node.remove());
  };
  window.addEventListener("pagehide", alunixaXDictationDispose, { once: true });
  window.__alunixaXDictationRuntime = { dispose: () => {
    window.removeEventListener("pagehide", alunixaXDictationDispose);
    alunixaXDictationDispose();
  } };
