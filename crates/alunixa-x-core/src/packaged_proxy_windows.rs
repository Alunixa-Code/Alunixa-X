use super::*;
use ::windows::Win32::System::Registry::{
    HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE, REG_DWORD, REG_EXPAND_SZ, REG_SZ,
    RegCloseKey, RegDeleteValueW, RegOpenKeyExW, RegQueryValueExW, RegSetValueExW,
};
use ::windows::core::PCWSTR;
use base64::Engine;
use std::ffi::c_void;

const KEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Internet Settings";

#[link(name = "kernel32")]
unsafe extern "system" {
    fn GetCurrentPackageFullName(length: *mut u32, name: *mut u16) -> i32;
}
#[link(name = "ntdll")]
unsafe extern "system" {
    fn NtQueryKey(
        handle: *mut c_void,
        class: u32,
        info: *mut c_void,
        size: u32,
        result: *mut u32,
    ) -> i32;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
struct Key(HKEY);
impl Drop for Key {
    fn drop(&mut self) {
        unsafe {
            let _ = RegCloseKey(self.0);
        }
    }
}
fn open(write: bool) -> anyhow::Result<Key> {
    let mut key = HKEY::default();
    unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(wide(KEY).as_ptr()),
            0,
            if write {
                KEY_READ | KEY_SET_VALUE
            } else {
                KEY_READ
            },
            &mut key,
        )
        .ok()?;
    }
    Ok(Key(key))
}

fn package_name() -> anyhow::Result<Option<String>> {
    let mut len = 0;
    let status = unsafe { GetCurrentPackageFullName(&mut len, std::ptr::null_mut()) };
    if status == 15700 {
        return Ok(None);
    }
    if status != 122 || len > 4096 {
        bail!("package_identity_query_failed");
    }
    let mut value = vec![0u16; len as usize];
    if unsafe { GetCurrentPackageFullName(&mut len, value.as_mut_ptr()) } != 0 {
        bail!("package_identity_query_failed");
    }
    Ok(Some(String::from_utf16_lossy(
        &value[..value.iter().position(|x| *x == 0).unwrap_or(value.len())],
    )))
}

fn read_value(key: HKEY, name: &str) -> anyhow::Result<Option<(u32, Vec<u8>)>> {
    let name = wide(name);
    let mut kind = REG_SZ;
    let mut size = 0u32;
    let status = unsafe {
        RegQueryValueExW(
            key,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            None,
            Some(&mut size),
        )
    };
    if status.0 == 2 {
        return Ok(None);
    }
    status.ok()?;
    if size > 64 * 1024 {
        bail!("proxy_registry_value_too_large");
    }
    let mut bytes = vec![0u8; size as usize];
    unsafe {
        RegQueryValueExW(
            key,
            PCWSTR(name.as_ptr()),
            None,
            Some(&mut kind),
            Some(bytes.as_mut_ptr()),
            Some(&mut size),
        )
        .ok()?;
    }
    bytes.truncate(size as usize);
    Ok(Some((kind.0, bytes)))
}

fn read_string(key: HKEY, name: &str) -> anyhow::Result<String> {
    let Some((kind, bytes)) = read_value(key, name)? else {
        return Ok(String::new());
    };
    if kind != REG_SZ.0 && kind != REG_EXPAND_SZ.0 {
        bail!("proxy_registry_type_invalid");
    }
    let value = bytes
        .chunks_exact(2)
        .map(|b| u16::from_le_bytes([b[0], b[1]]))
        .take_while(|v| *v != 0)
        .collect::<Vec<_>>();
    Ok(String::from_utf16(&value)?)
}

pub struct Registry;
impl ProxyRegistry for Registry {
    fn read(&self) -> anyhow::Result<ProxySnapshot> {
        let key = open(false)?;
        let enabled = match read_value(key.0, "ProxyEnable")? {
            None => None,
            Some((kind, bytes)) if kind == REG_DWORD.0 && bytes.len() == 4 => {
                Some(u32::from_le_bytes(bytes.try_into().unwrap()))
            }
            _ => bail!("proxy_registry_type_invalid"),
        };
        let mut required = 0u32;
        unsafe {
            NtQueryKey(key.0.0, 3, std::ptr::null_mut(), 0, &mut required);
        }
        if required < 4 || required > 64 * 1024 {
            bail!("registry_view_query_failed");
        }
        let mut identity = vec![0u8; required as usize];
        if unsafe {
            NtQueryKey(
                key.0.0,
                3,
                identity.as_mut_ptr().cast(),
                required,
                &mut required,
            )
        } < 0
        {
            bail!("registry_view_query_failed");
        }
        // Fingerprint the actual native key path, including its silo, without exposing the SID.
        let view_id = format!("{:x}", Sha256::digest(&identity));
        Ok(ProxySnapshot {
            package: package_name()?,
            view_id,
            enabled,
            server: read_string(key.0, "ProxyServer")?,
            pac: read_string(key.0, "AutoConfigURL")?,
            bypass: read_string(key.0, "ProxyOverride")?,
        })
    }
    fn set_enabled(&self, enabled: Option<u32>) -> anyhow::Result<()> {
        let key = open(true)?;
        unsafe {
            if let Some(value) = enabled {
                RegSetValueExW(
                    key.0,
                    PCWSTR(wide("ProxyEnable").as_ptr()),
                    0,
                    REG_DWORD,
                    Some(&value.to_le_bytes()),
                )
                .ok()?;
            } else {
                RegDeleteValueW(key.0, PCWSTR(wide("ProxyEnable").as_ptr())).ok()?;
            }
        }
        Ok(())
    }
}

pub async fn invoke_package(
    app_dir: &Path,
    launcher: &Path,
    action: &str,
    expected: Option<String>,
    backup_id: Option<String>,
) -> anyhow::Result<(ProxyViewReport, Option<String>)> {
    if !["inspect", "repair", "repair_at_startup", "restore"].contains(&action) {
        bail!("invalid_proxy_action");
    }
    let state = crate::paths::default_app_state_dir();
    std::fs::create_dir_all(&state).map_err(|_| anyhow::anyhow!("probe_workspace_failed"))?;
    let dir = tempfile::Builder::new()
        .prefix("proxy-probe-")
        .tempdir_in(&state)
        .map_err(|_| anyhow::anyhow!("probe_workspace_failed"))?;
    let request = ProbeRequest {
        nonce: uuid::Uuid::new_v4().to_string(),
        package: String::new(),
        action: action.into(),
        expected_revision: expected,
        backup_id,
        backup_dir: state.join("packaged-proxy-backups"),
        output: dir.path().join("result.json"),
    };
    let input = serde_json::json!({
        "appDirectory": app_dir, "launcher": launcher, "request": request,
        "requestPath": dir.path().join("request.json")
    });
    let payload = base64::engine::general_purpose::STANDARD.encode(serde_json::to_vec(&input)?);
    let script = include_str!("../assets/proxy-package.ps1").replace("__AX_REQUEST__", &payload);
    let command = base64::engine::general_purpose::STANDARD.encode(
        script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let system_root = std::env::var_os("SystemRoot").unwrap_or_else(|| "C:\\Windows".into());
    let powershell =
        PathBuf::from(system_root).join("System32/WindowsPowerShell/v1.0/powershell.exe");
    let output = tokio::process::Command::new(powershell)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-WindowStyle",
            "Hidden",
            "-EncodedCommand",
            &command,
        ])
        .creation_flags(crate::windows_create_no_window())
        .kill_on_drop(true)
        .output();
    let output = tokio::time::timeout(Duration::from_secs(25), output)
        .await
        .map_err(|_| anyhow::anyhow!("package_probe_timeout"))?
        .map_err(|_| anyhow::anyhow!("package_probe_spawn_failed"))?;
    if !output.status.success() {
        bail!("package_activation_or_probe_failed");
    }
    let bytes =
        std::fs::read(&request.output).map_err(|_| anyhow::anyhow!("package_probe_no_result"))?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|_| anyhow::anyhow!("package_probe_invalid_result"))?;
    if value.get("nonce").and_then(|v| v.as_str()) != Some(&request.nonce) {
        bail!("package_probe_nonce_mismatch");
    }
    if let Some(error) = value.get("error").and_then(|v| v.as_str()) {
        if error.len() < 96 && error.chars().all(|c| c.is_ascii_lowercase() || c == '_') {
            bail!("{error}");
        }
        bail!("package_proxy_operation_failed");
    }
    let view: ProxyViewReport =
        serde_json::from_value(value.get("view").cloned().unwrap_or_default())
            .map_err(|_| anyhow::anyhow!("package_probe_invalid_result"))?;
    let backup = value
        .get("backupId")
        .and_then(|v| v.as_str())
        .map(ToOwned::to_owned);
    Ok((view, backup))
}
