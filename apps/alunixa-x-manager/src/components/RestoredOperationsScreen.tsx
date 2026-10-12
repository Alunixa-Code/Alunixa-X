import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { t } from "../i18n";

type Operation = Record<string, unknown>;

export function RestoredOperationsScreen({ section, onSettingsChanged }: {
  section: "remote" | "projects" | "usage"; onSettingsChanged?: () => Promise<unknown>;
}) {
  const [status, setStatus] = useState<Operation | null>(null);
  const [login, setLogin] = useState<Operation | null>(null);
  const [pairing, setPairing] = useState<Operation | null>(null);
  const [projects, setProjects] = useState<Operation[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [host, setHost] = useState("");
  const [path, setPath] = useState("");
  const request = async (action: string, payload: Operation = {}) => {
    if (busy) return null;
    setBusy(true); setError("");
    try {
      const result = await invoke<Operation>("restored_agent_operation", { action, payload });
      if (result.status === "failed") throw new Error(String(result.message || "failed"));
      if (action === "login/logout" || (action === "login/status" && result.state === "succeeded")) {
        await onSettingsChanged?.();
      }
      return result;
    } catch (cause) { setError(String(cause)); return null; }
    finally { setBusy(false); }
  };
  const refresh = async () => {
    const result = await request(section === "remote" ? "remote/status" : section === "projects" ? "zed/projects" : "usage");
    if (result) {
      setStatus(result);
      if (section === "projects") setProjects(Array.isArray(result.projects) ? result.projects : []);
    }
  };
  const mutateRemote = async (action: string) => {
    const result = await request(action);
    if (!result) return;
    if (action.startsWith("login/")) setLogin(result);
    else if (action === "remote/pair") setPairing(result);
    else setStatus(result);
  };
  const clients = Array.isArray(status?.clients) ? status.clients as Operation[] : [];
  const url = String(login?.authUrl || login?.verificationUrl || login?.verificationUri || "");
  const safeUrl = /^https:\/\//.test(url) ? url : "";
  return <section className="settings-page restored-operations">
    <header className="enhance-page-toolbar">
      <h2>{section === "remote" ? t("官方手机远控") : section === "projects" ? t("远程项目") : t("Token 与模型使用统计")}</h2>
      <Button disabled={busy} onClick={() => void refresh()}>{t("刷新")}</Button>
    </header>
    {error ? <p role="alert">{error}</p> : null}
    {section === "remote" ? <>
      <p>{t("使用浏览器 OAuth 或设备码，将 ChatGPT 账号安全连接到本机 Codex")}</p>
      <div className="feature-action-row">
        <Button disabled={busy} onClick={() => void mutateRemote("login/browser")}>{t("网页登录")}</Button>
        <Button disabled={busy} onClick={() => void mutateRemote("login/device")}>{t("设备码登录")}</Button>
        <Button disabled={busy} variant="outline" onClick={() => {
          if (window.confirm(t("退出 ChatGPT 账号登录？"))) void mutateRemote("login/logout");
        }}>{t("退出登录")}</Button>
      </div>
      {login ? <div className="feature-choice-row">
        {safeUrl ? <a href={safeUrl} target="_blank" rel="noreferrer">{t("打开登录网页")}</a> : null}
        <code>{String(login.userCode || login.loginId || "")}</code>
        <Button disabled={busy} onClick={() => void request("login/status", { loginId: login.loginId }).then(result => {
          if (result) setLogin(result);
        })}>{t("检查登录结果")}</Button>
        <Button disabled={busy} variant="outline" onClick={() => void request("login/cancel", { loginId: login.loginId }).then(result => {
          if (result) setLogin(null);
        })}>{t("取消")}</Button>
        <p>{String(login.message || login.state || "")}</p>
      </div> : null}
      <div className="feature-action-row">
        <Button disabled={busy} onClick={() => void mutateRemote("remote/enable")}>{t("启用官方远控")}</Button>
        <Button disabled={busy} variant="outline" onClick={() => void mutateRemote("remote/disable")}>{t("关闭官方远控")}</Button>
        <Button disabled={busy} onClick={() => void mutateRemote("remote/pair")}>{t("生成手机配对码")}</Button>
      </div>
      <p>{String(status?.accountLabel || "")} · {String(status?.status || "")}</p>
      {pairing ? <div className="feature-choice-row">
        <code>{String(pairing.manualPairingCode || pairing.pairingCode || "")}</code>
        <Button disabled={busy} onClick={()=>void request("remote/pair-status",pairing).then(result=>{
          if(result?.claimed) setPairing({...pairing,claimed:true});
        })}>{t("检查配对状态")}</Button>
        <Button onClick={()=>void navigator.clipboard.writeText(String(pairing.manualPairingCode || pairing.pairingCode || ""))}>{t("复制")}</Button>
        {pairing.claimed ? <span>{t("已配对")}</span> : null}
      </div> : null}
      {clients.map(client => <div className="feature-action-row" key={String(client.clientId)}>
        <span>{String(client.displayName || client.clientId)}</span>
        <Button disabled={busy} variant="outline" onClick={() => {
          if (window.confirm(t("撤销所选手机设备？"))) void request("remote/revoke", {
            environmentId: status?.environmentId, clientId: client.clientId,
          }).then(result => { if (result) setStatus(result); });
        }}>{t("撤销设备")}</Button>
      </div>)}
    </> : null}
    {section === "projects" ? <>
      <div className="relay-options-grid">
        <label className="field"><span>SSH</span><Input aria-label="SSH" value={host} onChange={event => setHost(event.currentTarget.value)} /></label>
        <label className="field"><span>{t("项目路径")}</span><Input aria-label={t("项目路径")} value={path} onChange={event => setPath(event.currentTarget.value)} /></label>
      </div>
      <Button disabled={busy || !host.trim() || !path.trim()} onClick={() => void request("zed/open", { ssh:{host}, path, source:"manager" })}>{t("在 Zed 打开")}</Button>
      {projects.map(project => <article className="custom-model-block" key={String(project.id || project.path)}>
        <strong>{String(project.name || project.path || project.cwd)}</strong>
        <p>{String(project.host || project.hostId || "")}</p>
        <Button disabled={busy} onClick={() => void request("zed/open", project)}>{t("打开")}</Button>
        <Button disabled={busy} variant="outline" onClick={() => void request("zed/forget", project).then(result => {
          if (result) setProjects(items => items.filter(item => item !== project));
        })}>{t("移除记录")}</Button>
      </article>)}
    </> : null}
    {section === "usage" ? <>
      <div className="relay-options-grid">
        {[["累计 Token","totalTokens"],["输入 Token","inputTokens"],["输出 Token","outputTokens"],["缓存 Token","cachedTokens"],["调用回合","turns"],["扫描会话","sessionsScanned"]].map(([label,key]) =>
          <div className="custom-model-block" key={key}><span>{t(label)}</span><strong>{Number(status?.[key] || 0).toLocaleString()}</strong></div>)}
      </div>
      <div className="agent-health-table"><table><thead><tr><th>{t("模型名称")}</th><th>{t("调用回合")}</th><th>Token</th></tr></thead>
        <tbody>{(Array.isArray(status?.modelUsage) ? status.modelUsage as Operation[] : []).map(row =>
          <tr key={String(row.model)}><td>{String(row.model)}</td><td>{Number(row.turns || 0)}</td><td>{Number(row.tokens || 0).toLocaleString()}</td></tr>)}</tbody>
      </table></div>
    </> : null}
  </section>;
}
