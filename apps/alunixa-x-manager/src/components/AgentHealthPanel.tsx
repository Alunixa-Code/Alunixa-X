import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw, RotateCcw, ShieldCheck, Wrench } from "lucide-react";
import { getLanguage, t } from "@/i18n";

type View = { package: string | null; viewId: string; enabled: number | null; state: string; revision: string; loopbackEndpoints: string[] };
type ProxyReport = { status: string; message: string; packaged: View | null; host: View | null; repaired: boolean; restartRequired: boolean; backupId: string | null };
type Entry = { key: string; desired: unknown; disk: unknown; state: string; source: string; dependency: string; effect: string };
type Audit = { revision: string; configPath: string; cliPath: string | null; scope: string; overrides: string[]; entries: Entry[] };

const copy = {
  zh: { title: "运行与配置核对", refresh: "重新检测", proxy: "应用隔离代理", repair: "备份并修复", restore: "恢复上次备份",
    auto: "启动时修复失效的应用隔离代理", check: "检查代理", pending: "检测中", error: "检测失败，状态未知",
    missing: "未取得应用上下文", changed: "检测到外部配置变化，请刷新设置后再保存", desired: "管理器期望", disk: "磁盘/CLI 默认", state: "验证状态",
    capability: "能力", unknown: "未知", saved: "已保存", saved_pending_restart: "已保存，待重启生效", unverified: "运行时未验证",
    unsupported: "不支持/未实现", different: "与磁盘不一致", overridden: "profile 覆盖", missing_dependency: "缺少依赖",
    footer: "全局/profile 检查；项目、启动参数和运行中任务可能覆盖配置", enabled: "开", disabled: "关", restart: "需要重新启动相关 Codex 进程",
    confirmRestore: "恢复会重新启用备份中的代理，是否继续？", config: "配置来源", reload: "重新读取配置",
    dependency: "依赖与支持条件", effect: "生效时机", restartEffect: "重启后核对", nextRequest: "后续请求",
    hostProxy: "普通进程视图", packageProxy: "应用包实际视图", endpoints: "本机端点" },
  en: { title: "Runtime and configuration", refresh: "Check again", proxy: "Packaged app proxy", repair: "Back up and repair", restore: "Restore last backup",
    auto: "Repair dead packaged proxies before launch", check: "Inspect proxy", pending: "Checking", error: "Check failed; state unknown",
    missing: "Application context unavailable", changed: "External configuration changed. Refresh settings before saving.", desired: "Manager intent", disk: "Disk / CLI default", state: "Verification",
    capability: "Capability", unknown: "Unknown", saved: "Saved", saved_pending_restart: "Saved; restart pending", unverified: "Runtime unverified",
    unsupported: "Unsupported / not implemented", different: "Differs from disk", overridden: "Profile override", missing_dependency: "Missing dependency",
    footer: "Global/profile only; project, launch arguments and running tasks may override these values", enabled: "On", disabled: "Off", restart: "Restart the affected Codex processes",
    confirmRestore: "Restoring re-enables the backed-up proxy. Continue?", config: "Configuration source", reload: "Reload configuration",
    dependency: "Dependencies and support", effect: "When applied", restartEffect: "Verify after restart", nextRequest: "Next request",
    hostProxy: "Host process view", packageProxy: "Actual package view", endpoints: "Loopback endpoints" },
  ru: { title: "Проверка среды и настроек", refresh: "Проверить снова", proxy: "Прокси приложения", repair: "Сохранить и исправить", restore: "Восстановить копию",
    auto: "Исправлять неработающий прокси пакета при запуске", check: "Проверить прокси", pending: "Проверка", error: "Проверка не удалась; состояние неизвестно",
    missing: "Контекст приложения недоступен", changed: "Внешние настройки изменены. Обновите их перед сохранением.", desired: "В менеджере", disk: "Файл / по умолчанию CLI", state: "Проверка",
    capability: "Возможность", unknown: "Неизвестно", saved: "Сохранено", saved_pending_restart: "Сохранено; нужен перезапуск", unverified: "Работа не проверена",
    unsupported: "Не поддерживается / не реализовано", different: "Отличается от файла", overridden: "Переопределено профилем", missing_dependency: "Нет зависимости",
    footer: "Только глобальный файл/профиль; проект, аргументы и активные задачи могут переопределить значения", enabled: "Вкл.", disabled: "Выкл.", restart: "Перезапустите соответствующие процессы Codex",
    confirmRestore: "Восстановление включит прежний прокси. Продолжить?", config: "Источник настроек", reload: "Перечитать настройки",
    dependency: "Зависимости и поддержка", effect: "Применение", restartEffect: "Проверить после перезапуска", nextRequest: "Следующий запрос",
    hostProxy: "Обычный процесс", packageProxy: "Контекст пакета", endpoints: "Локальные адреса" },
} as const;

export function AgentHealthPanel({ autoRepair, onAutoRepairChange, onAudit, savedRevision, onReload }: {
  autoRepair: boolean; onAutoRepairChange: (enabled: boolean) => void;
  onAudit?: (entries: Entry[] | null) => void;
  savedRevision?: string | null;
  onReload?: () => Promise<unknown>;
}) {
  const text = copy[getLanguage()];
  const [audit, setAudit] = useState<Audit | null>(null);
  const [proxy, setProxy] = useState<ProxyReport | null>(null);
  const [backup, setBackup] = useState<string | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [externalChange, setExternalChange] = useState(false);
  const sequence = useRef(0);
  const revision = useRef<string | null>(null);
  const onAuditRef = useRef(onAudit);
  onAuditRef.current = onAudit;
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    try {
      const next = await invoke<Audit>("inspect_agent_capabilities");
      if (request !== sequence.current) return;
      const stale = !!revision.current && revision.current !== next.revision;
      if (stale) setExternalChange(true);
      if (!stale) revision.current = next.revision;
      setAudit(next);
      onAuditRef.current?.(stale ? null : next.entries);
      setError("");
    } catch (cause) {
      if (request !== sequence.current) return;
      setAudit(null); onAuditRef.current?.(null);
      setError(typeof cause === "string" ? `${text.error}: ${t(cause)}` : text.error);
    }
  }, [text.error]);
  useEffect(() => {
    // A confirmed save/reload is not an external modification.
    revision.current = savedRevision ?? null;
    setExternalChange(false);
    void refresh();
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus);
    return () => { sequence.current++; window.removeEventListener("focus", focus); };
  }, [refresh, savedRevision]);
  const operate = async (action: string) => {
    if (busy) return;
    if (action === "restore" && !window.confirm(text.confirmRestore)) return;
    setBusy(action); setError("");
    try {
      const result = await invoke<ProxyReport>("packaged_proxy_action", {
        action, expectedRevision: proxy?.packaged?.revision ?? null, backupId: backup,
      });
      setProxy(result);
      setBackup(result.backupId);
      if (result.status !== "ok") setError(t(result.message));
    } catch { setError(text.error); }
    finally { setBusy(""); }
  };
  const show = (value: unknown) => value == null ? text.unknown
    : typeof value === "boolean" ? value ? text.enabled : text.disabled : String(value);
  const stateLabel = (state: string) => state in text ? text[state as keyof typeof text] : state;
  return <section className="agent-health-panel">
    <header><h2><ShieldCheck size={18} />{text.title}</h2>
      <button type="button" onClick={() => void refresh()}><RefreshCw size={15} />{text.refresh}</button></header>
    {error ? <p role="alert">{error}</p> : null}
    {externalChange ? <p role="status">{text.changed} {onReload ?
      <button type="button" onClick={() => void onReload()}>{text.reload}</button> : null}</p> : null}
    <div className="agent-health-proxy">
      <label><input type="checkbox" disabled={!audit || externalChange || audit.entries.find(entry => entry.key === "codexAppPackagedProxyRepair")?.state === "unsupported"} checked={autoRepair} onChange={e => onAutoRepairChange(e.currentTarget.checked)} />{text.auto}</label>
      <div className="agent-health-actions">
        <button disabled={!!busy} type="button" onClick={() => void operate("inspect")}><RefreshCw size={15} />{text.check}</button>
        <button disabled={!!busy || proxy?.packaged?.state !== "dead_loopback"} type="button" onClick={() => void operate("repair")}><Wrench size={15} />{text.repair}</button>
        <button disabled={!!busy || !backup} type="button" onClick={() => void operate("restore")}><RotateCcw size={15} />{text.restore}</button>
      </div>
      {busy ? <p role="status">{text.pending}</p> : null}
      <p>{proxy?.message ? t(proxy.message) : text.missing}</p>
      {proxy ? <dl>
        <dt>{text.hostProxy}</dt><dd><code>ProxyEnable={proxy.host?.enabled ?? "?"} · {proxy.host?.state ?? text.unknown}</code></dd>
        <dt>{text.packageProxy}</dt><dd><code>ProxyEnable={proxy.packaged?.enabled ?? "?"} · {proxy.packaged?.state ?? text.unknown}</code></dd>
      </dl> : null}
      {proxy?.packaged ? <>
        <code>{proxy.packaged.package} · view:{proxy.packaged.viewId.slice(0, 12)}</code>
        {proxy.packaged.loopbackEndpoints.length ? <p>{text.endpoints}: <code>{proxy.packaged.loopbackEndpoints.join(", ")}</code></p> : null}
      </> : null}
      {proxy?.restartRequired ? <p role="status">{text.restart}</p> : null}
    </div>
    {audit ? <>
      <p><span>{text.config}: </span><code>{audit.configPath}</code></p>
      <div className="agent-health-table"><table>
        <thead><tr><th>{text.capability}</th><th>{text.desired}</th><th>{text.disk}</th><th>{text.state}</th></tr></thead>
        <tbody>{audit.entries.map(entry => <tr key={entry.key} title={`${entry.source}\n${entry.dependency}`}>
          <td><details><summary><code>{entry.key}</code></summary>
            <p>{text.config}: {entry.source}</p><p>{text.dependency}: {t(entry.dependency)}</p>
            <p>{text.effect}: {entry.effect === "restart" ? text.restartEffect : entry.effect === "next_request" ? text.nextRequest : text.unknown}</p>
          </details></td><td>{show(entry.desired)}</td><td>{show(entry.disk)}</td><td>{stateLabel(entry.state)}</td>
        </tr>)}</tbody>
      </table></div>
      <p>{text.footer}</p>
      {audit.overrides.length ? <ul>{audit.overrides.map(item => <li key={item}><code>{item}</code></li>)}</ul> : null}
    </> : <p>{text.unknown}</p>}
  </section>;
}
