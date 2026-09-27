//! Inspect and repair only the registry view belonging to the selected desktop package.
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::time::Duration;

use anyhow::{Context, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxySnapshot {
    pub package: Option<String>,
    pub view_id: String,
    pub enabled: Option<u32>,
    pub server: String,
    pub pac: String,
    pub bypass: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ProxyState {
    Disabled,
    DeadLoopback,
    ReachableLoopback,
    ExternalProxy,
    PacConfigured,
    Unknown,
    Unsupported,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyViewReport {
    pub package: Option<String>,
    pub view_id: String,
    pub enabled: Option<u32>,
    pub state: ProxyState,
    pub revision: String,
    pub loopback_endpoints: Vec<String>,
    pub has_server: bool,
    pub has_pac: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyReport {
    pub host: Option<ProxyViewReport>,
    pub packaged: Option<ProxyViewReport>,
    pub status: String,
    pub message: String,
    pub repaired: bool,
    pub restart_required: bool,
    pub backup_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProbeRequest {
    nonce: String,
    package: String,
    action: String,
    expected_revision: Option<String>,
    backup_id: Option<String>,
    backup_dir: PathBuf,
    output: PathBuf,
}

#[derive(Serialize, Deserialize)]
struct Backup {
    before: ProxySnapshot,
    after_revision: String,
}

pub fn snapshot_revision(snapshot: &ProxySnapshot) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(snapshot).unwrap_or_default())
    )
}

/// No DNS queries or remote connections: only literal loopback and localhost qualify.
pub fn loopback_endpoints(server: &str) -> Option<Vec<SocketAddr>> {
    let mut result = Vec::new();
    for part in server.split(';').map(str::trim).filter(|s| !s.is_empty()) {
        let address = if let Some((scheme, address)) = part.split_once('=') {
            if !["http", "https", "socks", "socks5"].contains(&scheme.to_ascii_lowercase().as_str())
            {
                return None;
            }
            address
        } else {
            part
        };
        let url = url::Url::parse(&if address.contains("://") {
            address.to_owned()
        } else {
            format!("http://{address}")
        })
        .ok()?;
        if !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return None;
        }
        // An omitted port is ambiguous. Never guess a default for automatic repair.
        let authority = address.split("://").last()?;
        let port = authority
            .rsplit_once(':')?
            .1
            .trim_end_matches('/')
            .parse::<u16>()
            .ok()?;
        if port == 0 {
            return None;
        }
        let host = url.host_str()?.trim_matches(['[', ']']);
        if host.eq_ignore_ascii_case("localhost") {
            result.push(SocketAddr::new(IpAddr::V4(Ipv4Addr::LOCALHOST), port));
            result.push(SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), port));
        } else {
            let ip: IpAddr = host.parse().ok()?;
            if !ip.is_loopback() {
                return None;
            }
            result.push(SocketAddr::new(ip, port));
        }
    }
    result.sort_unstable();
    result.dedup();
    (!result.is_empty() && result.len() <= 8).then_some(result)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PortState {
    Listening,
    Refused,
    Unknown,
}

pub fn classify(
    snapshot: &ProxySnapshot,
    mut probe: impl FnMut(SocketAddr) -> PortState,
) -> ProxyState {
    // Disabled ProxyServer addresses are not failures, even if that port is gone.
    if snapshot.enabled == Some(0) || snapshot.enabled.is_none() {
        return if snapshot.pac.trim().is_empty() {
            ProxyState::Disabled
        } else {
            ProxyState::PacConfigured
        };
    }
    if snapshot.enabled != Some(1) {
        return ProxyState::Unknown;
    }
    if !snapshot.pac.trim().is_empty() {
        return ProxyState::PacConfigured;
    }
    let Some(endpoints) = loopback_endpoints(&snapshot.server) else {
        return if snapshot.server.trim().is_empty() {
            ProxyState::Unknown
        } else {
            ProxyState::ExternalProxy
        };
    };
    let mut reachable = false;
    for endpoint in endpoints {
        match probe(endpoint) {
            PortState::Listening => reachable = true,
            PortState::Unknown => return ProxyState::Unknown,
            PortState::Refused => {}
        }
    }
    if reachable {
        ProxyState::ReachableLoopback
    } else {
        ProxyState::DeadLoopback
    }
}

fn probe_port(address: SocketAddr) -> PortState {
    for attempt in 0..2 {
        match TcpStream::connect_timeout(&address, Duration::from_millis(300)) {
            Ok(_) => return PortState::Listening,
            Err(error) if error.kind() == std::io::ErrorKind::ConnectionRefused => {
                if attempt == 0 {
                    std::thread::sleep(Duration::from_millis(150));
                }
            }
            Err(_) => return PortState::Unknown,
        }
    }
    PortState::Refused
}

fn report_view(snapshot: &ProxySnapshot) -> ProxyViewReport {
    ProxyViewReport {
        package: snapshot.package.clone(),
        view_id: snapshot.view_id.clone(),
        enabled: snapshot.enabled,
        state: classify(snapshot, probe_port),
        revision: snapshot_revision(snapshot),
        loopback_endpoints: loopback_endpoints(&snapshot.server)
            .unwrap_or_default()
            .iter()
            .map(ToString::to_string)
            .collect(),
        has_server: !snapshot.server.is_empty(),
        has_pac: !snapshot.pac.is_empty(),
    }
}

pub trait ProxyRegistry {
    fn read(&self) -> anyhow::Result<ProxySnapshot>;
    fn set_enabled(&self, enabled: Option<u32>) -> anyhow::Result<()>;
}

/// Compare, back up, modify one value, and read back in the SAME package process.
pub fn repair<R: ProxyRegistry>(
    registry: &R,
    expected: &str,
    backup_dir: &Path,
    mut probe: impl FnMut(SocketAddr) -> PortState,
) -> anyhow::Result<(ProxySnapshot, Option<String>)> {
    let before = registry.read()?;
    if before.package.is_none() {
        bail!("package_identity_missing");
    }
    if snapshot_revision(&before) != expected {
        bail!("proxy_changed_refresh_required");
    }
    if classify(&before, &mut probe) != ProxyState::DeadLoopback {
        return Ok((before, None));
    }
    // Retain an exact private snapshot. Registry values are never sent to the renderer/log.
    let id = uuid::Uuid::new_v4().to_string();
    let mut after = before.clone();
    after.enabled = Some(0);
    let backup = Backup {
        before: before.clone(),
        after_revision: snapshot_revision(&after),
    };
    std::fs::create_dir_all(backup_dir)?;
    crate::settings::atomic_write(
        &backup_dir.join(format!("{id}.json")),
        &serde_json::to_vec(&backup)?,
    )?;
    if registry.read()? != before {
        bail!("proxy_changed_refresh_required");
    }
    registry.set_enabled(Some(0))?;
    let readback = registry.read()?;
    if readback != after {
        // Do not overwrite an intervening external change. The backup remains recoverable.
        bail!("proxy_readback_mismatch");
    }
    Ok((readback, Some(id)))
}

pub fn restore<R: ProxyRegistry>(
    registry: &R,
    backup_dir: &Path,
    id: &str,
) -> anyhow::Result<ProxySnapshot> {
    let id = uuid::Uuid::parse_str(id).context("invalid_backup_id")?;
    let backup: Backup =
        serde_json::from_slice(&std::fs::read(backup_dir.join(format!("{id}.json")))?)?;
    let current = registry.read()?;
    if current.package.is_none()
        || current.package != backup.before.package
        || snapshot_revision(&current) != backup.after_revision
    {
        bail!("proxy_changed_restore_refused");
    }
    registry.set_enabled(backup.before.enabled)?;
    let restored = registry.read()?;
    if restored != backup.before {
        bail!("proxy_restore_readback_mismatch");
    }
    Ok(restored)
}

fn recoverable_backup(dir: &Path, current: &ProxySnapshot) -> Option<String> {
    let revision = snapshot_revision(current);
    let mut entries = std::fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.metadata().and_then(|m| m.modified()).ok());
    entries.into_iter().rev().take(64).find_map(|entry| {
        let path = entry.path();
        let id = uuid::Uuid::parse_str(path.file_stem()?.to_str()?).ok()?;
        let backup: Backup = serde_json::from_slice(&std::fs::read(&path).ok()?).ok()?;
        (backup.after_revision == revision && backup.before.package == current.package)
            .then(|| id.to_string())
    })
}

/// Child entry point used only via Invoke-CommandInDesktopPackage.
pub fn run_probe_request(path: &Path) -> anyhow::Result<()> {
    let request: ProbeRequest = serde_json::from_slice(&std::fs::read(path)?)?;
    uuid::Uuid::parse_str(&request.nonce)?;
    #[cfg(windows)]
    {
        let registry = windows::Registry;
        let operation = (|| {
            let before = registry.read()?;
            if before.package.as_deref() != Some(request.package.as_str()) {
                bail!("unexpected_package_identity");
            }
            let (snapshot, id) = match request.action.as_str() {
                "inspect" => {
                    let id = recoverable_backup(&request.backup_dir, &before);
                    (before, id)
                }
                "repair" => repair(
                    &registry,
                    request.expected_revision.as_deref().unwrap_or(""),
                    &request.backup_dir,
                    probe_port,
                )?,
                "repair_at_startup" => repair(
                    &registry,
                    &snapshot_revision(&before),
                    &request.backup_dir,
                    probe_port,
                )?,
                "restore" => (
                    restore(
                        &registry,
                        &request.backup_dir,
                        request.backup_id.as_deref().unwrap_or(""),
                    )?,
                    None,
                ),
                _ => bail!("invalid_proxy_action"),
            };
            Ok::<_, anyhow::Error>((snapshot, id))
        })();
        let result = match operation {
            Ok((snapshot, backup_id)) => serde_json::json!({
                "nonce": request.nonce, "view": report_view(&snapshot),
                "backupId": backup_id, "error": null
            }),
            // Only fixed diagnostic categories leave the package context.
            Err(error) => {
                let category = error.to_string();
                let category = if category.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
                    category
                } else {
                    "package_proxy_operation_failed".into()
                };
                serde_json::json!({"nonce": request.nonce, "error": category})
            }
        };
        crate::settings::atomic_write(&request.output, &serde_json::to_vec(&result)?)?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = request;
        bail!("packaged_proxy_requires_windows")
    }
}

pub async fn inspect_or_repair(
    app_dir: &Path,
    launcher: &Path,
    action: &str,
    expected: Option<String>,
    backup_id: Option<String>,
) -> ProxyReport {
    let mut report = ProxyReport {
        host: None,
        packaged: None,
        status: "unknown".into(),
        message: "无法读取应用隔离代理视图，未修改任何代理。".into(),
        repaired: false,
        restart_required: false,
        backup_id: None,
    };
    #[cfg(windows)]
    {
        if let Ok(snapshot) = windows::Registry.read() {
            report.host = Some(report_view(&snapshot));
        }
        match windows::invoke_package(app_dir, launcher, action, expected, backup_id).await {
            Ok((view, id)) => {
                report.repaired = id.is_some() && action != "inspect";
                report.restart_required = report.repaired || action == "restore";
                report.backup_id = id;
                report.message = match view.state {
                    ProxyState::DeadLoopback => {
                        "应用隔离代理已启用，但所有本机端口均拒绝连接。可备份后定向关闭该代理。"
                    }
                    ProxyState::Disabled if report.repaired => {
                        "已备份并关闭失效的应用隔离代理，回读一致。已有 Codex 进程需重新启动。"
                    }
                    ProxyState::Disabled => "应用隔离手动代理未启用；残留地址不作为故障。",
                    ProxyState::PacConfigured => "应用存在 PAC 配置，自动修复不更改自动代理。",
                    ProxyState::ExternalProxy => "应用使用外部或无法安全判定的代理，已保留。",
                    ProxyState::ReachableLoopback => {
                        "应用本机代理端口可连接，已保留；此检查不代表上游请求成功。"
                    }
                    _ => "代理状态未知，未修改。",
                }
                .into();
                report.status = if view.state == ProxyState::Unknown {
                    "unknown"
                } else {
                    "ok"
                }
                .into();
                report.packaged = Some(view);
            }
            Err(error) => {
                // Outer errors contain only controlled stage labels, not the command or raw registry.
                report.message = format!(
                    "应用隔离代理检测失败（{}），未确认修复；请重新检测。",
                    error
                );
            }
        }
    }
    #[cfg(not(windows))]
    {
        let _ = (app_dir, launcher, action, expected, backup_id);
        report.status = "unsupported".into();
        report.message = "应用隔离注册表代理仅适用于 Windows 打包应用。".into();
    }
    report
}

#[cfg(windows)]
#[path = "packaged_proxy_windows.rs"]
mod windows;

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;
    struct Fake(RefCell<ProxySnapshot>);
    impl ProxyRegistry for Fake {
        fn read(&self) -> anyhow::Result<ProxySnapshot> {
            Ok(self.0.borrow().clone())
        }
        fn set_enabled(&self, v: Option<u32>) -> anyhow::Result<()> {
            self.0.borrow_mut().enabled = v;
            Ok(())
        }
    }
    fn snapshot() -> ProxySnapshot {
        ProxySnapshot {
            package: Some("fixture".into()),
            view_id: "view".into(),
            enabled: Some(1),
            server: "127.0.0.1:43210".into(),
            pac: String::new(),
            bypass: "<local>".into(),
        }
    }
    #[test]
    fn disabled_residual_address_never_probes_or_reports_dead() {
        let mut s = snapshot();
        s.enabled = Some(0);
        assert_eq!(
            classify(&s, |_| panic!("disabled proxy must not be probed")),
            ProxyState::Disabled
        );
    }
    #[test]
    fn only_confirmed_dead_all_loopback_without_pac_can_be_repaired() {
        let mut s = snapshot();
        assert_eq!(
            classify(&s, |_| PortState::Refused),
            ProxyState::DeadLoopback
        );
        assert_eq!(
            classify(&s, |_| PortState::Listening),
            ProxyState::ReachableLoopback
        );
        assert_eq!(classify(&s, |_| PortState::Unknown), ProxyState::Unknown);
        s.pac = "https://example.test/proxy.pac".into();
        assert_eq!(classify(&s, |_| panic!("PAC")), ProxyState::PacConfigured);
        s.pac.clear();
        s.server = "http=127.0.0.1:1234;https=proxy.test:8080".into();
        assert_eq!(
            classify(&s, |_| panic!("external")),
            ProxyState::ExternalProxy
        );
    }
    #[test]
    fn endpoint_parser_rejects_credentials_non_loopback_and_ambiguous_values() {
        for value in [
            "",
            "proxy.test:8080",
            "127.0.0.1",
            "127.0.0.1:0",
            "http://u:p@127.0.0.1:8080",
            "http://127.0.0.1:8080/path",
        ] {
            assert_eq!(loopback_endpoints(value), None, "{value}");
        }
        assert_eq!(loopback_endpoints("localhost:2345").unwrap().len(), 2);
        assert_eq!(
            loopback_endpoints("http=127.0.0.2:4321;https=[::1]:4321")
                .unwrap()
                .len(),
            2
        );
    }
    #[test]
    fn repair_backs_up_exactly_and_restore_refuses_external_changes() {
        let dir = tempfile::tempdir().unwrap();
        let registry = Fake(RefCell::new(snapshot()));
        let revision = snapshot_revision(&registry.read().unwrap());
        let (after, id) = repair(&registry, &revision, dir.path(), |_| PortState::Refused).unwrap();
        assert_eq!(after.enabled, Some(0));
        assert_eq!(after.server, snapshot().server);
        assert_eq!(
            restore(&registry, dir.path(), id.as_deref().unwrap()).unwrap(),
            snapshot()
        );
        assert!(repair(&registry, "stale", dir.path(), |_| PortState::Refused).is_err());
        let (_, id) = repair(&registry, &revision, dir.path(), |_| PortState::Refused).unwrap();
        registry.0.borrow_mut().server = "localhost:9999".into();
        assert!(restore(&registry, dir.path(), id.as_deref().unwrap()).is_err());
    }
    #[test]
    fn backup_failure_and_healthy_proxy_leave_registry_unchanged() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("file");
        std::fs::write(&file, b"x").unwrap();
        let registry = Fake(RefCell::new(snapshot()));
        let revision = snapshot_revision(&snapshot());
        assert!(repair(&registry, &revision, &file, |_| PortState::Refused).is_err());
        assert_eq!(registry.read().unwrap(), snapshot());
        assert!(
            repair(&registry, &revision, dir.path(), |_| PortState::Listening)
                .unwrap()
                .1
                .is_none()
        );
        registry.0.borrow_mut().package = None;
        assert!(repair(&registry, &revision, dir.path(), |_| PortState::Refused).is_err());
    }
}
