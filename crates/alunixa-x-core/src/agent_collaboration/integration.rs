//! 显式接入 Codex 的协作 MCP；只管理本条 stdio server，不读取或改写认证文件。

use std::fs::{File, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use anyhow::{Context, bail};
use fs2::FileExt;
use serde::Serialize;
use toml_edit::{DocumentMut, Item, Table, Value};

pub const SERVER_ID: &str = "alunixa_x_collaboration";
const MCP_FLAG: &str = "--alunixa-x-agent-mcp";
const MAX_CONFIG_BYTES: u64 = 4 * 1024 * 1024;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistrationStatus {
    /// registered / missing / needs_update / conflict。
    pub status: String,
    pub message: String,
    pub home: String,
    pub config_path: String,
    pub registered: bool,
    pub owned: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallReceipt {
    pub status: RegistrationStatus,
    pub changed: bool,
    pub backup_path: Option<String>,
}

/// 只读检查本条 MCP；存在配置不代表已启动的 Codex 会话已经重新加载工具。
pub fn status(
    home: &Path,
    executable: &Path,
    state_dir: &Path,
) -> anyhow::Result<RegistrationStatus> {
    let home = validate_paths(home, executable, state_dir)?;
    let path = home.join("config.toml");
    let config = read_config(&path)?;
    let document = parse_config(config.as_deref().unwrap_or(""))?;
    status_from_document(&home, &document, executable, state_dir)
}

/// 原子安装/更新 live config。本条发生变化时先保存私有备份；重复安装不重写文件。
/// 管理器同时保存托管上下文；live 发布失败时只回滚本次上下文字段。
pub fn install(home: &Path, executable: &Path, state_dir: &Path) -> anyhow::Result<InstallReceipt> {
    let home = validate_paths(home, executable, state_dir)?;
    let lock_path = home.join(".alunixa-x-agent-mcp.lock");
    reject_symlink(&lock_path)?;
    let lock = open_private_new_or_existing(&lock_path)?;
    FileExt::lock_exclusive(&lock).context("无法锁定协作 MCP 接入操作")?;
    let path = home.join("config.toml");
    let before = read_config(&path)?;
    let updated = upsert_managed_context(before.as_deref().unwrap_or(""), executable, state_dir)?;
    if before.as_deref() == Some(updated.as_str()) {
        let document = parse_config(&updated)?;
        return Ok(InstallReceipt {
            status: status_from_document(&home, &document, executable, state_dir)?,
            changed: false,
            backup_path: None,
        });
    }
    let backup_path = before
        .as_deref()
        .map(|contents| backup_config(&home, contents))
        .transpose()?;
    // 其他程序不一定遵守本锁；发现读取后的变化就拒绝提交，不能覆盖它的新配置。
    if read_config(&path)? != before {
        bail!("Codex 配置在接入期间发生变化，未覆盖；请重新检查后再接入");
    }
    crate::settings::atomic_write_with(&path, |file| {
        // atomic_write_with 会在写完后恢复原权限；写入内容前先收紧临时文件权限。
        make_private(file)?;
        file.write_all(updated.as_bytes())
    })
    .context("无法原子保存 Codex 协作 MCP 配置")?;
    let document = parse_config(&updated)?;
    Ok(InstallReceipt {
        status: status_from_document(&home, &document, executable, state_dir)?,
        changed: true,
        backup_path: backup_path.map(|path| path.to_string_lossy().into_owned()),
    })
}

/// 纯转换：用于 settings.relay_context_config_contents，保留其他 server 与未知选项。
/// 不调用既有“覆盖整条” helper，以便保留此条上用户设置的 approval_mode 等字段。
pub fn upsert_managed_context(
    contents: &str,
    executable: &Path,
    state_dir: &Path,
) -> anyhow::Result<String> {
    validate_launch_paths(executable, state_dir)?;
    let mut document = parse_config(contents)?;
    if let Some(server) = server_entry(&document)? {
        if !is_owned(server) {
            bail!("同名 alunixa_x_collaboration 已被其他 MCP 配置占用，未覆盖");
        }
        if has_transport_conflict(server) {
            bail!("同名协作 MCP 包含 HTTP url，不能安全接管，未修改配置");
        }
    }
    if document.get("mcp_servers").is_none() {
        let mut servers = Table::new();
        servers.set_implicit(true);
        document
            .as_table_mut()
            .insert("mcp_servers", Item::Table(servers));
    }
    let servers = document
        .get_mut("mcp_servers")
        .and_then(Item::as_table_like_mut)
        .context("mcp_servers 必须是 TOML 表，未修改配置")?;
    let new_entry = servers.get(SERVER_ID).is_none();
    if new_entry {
        let mut server = Table::new();
        server
            .decor_mut()
            .set_prefix("\n# Managed by Alunixa X: agent collaboration MCP\n");
        servers.insert(SERVER_ID, Item::Table(server));
    }
    let server = servers
        .get_mut(SERVER_ID)
        .and_then(Item::as_table_like_mut)
        .context("协作 MCP 条目必须是 TOML 表，未修改配置")?;
    if server.get("command").and_then(Item::as_str) != executable.to_str() {
        set_value_preserving_decor(server, "command", Value::from(path_text(executable)?));
    }
    if !args_match(server.get("args").and_then(Item::as_array), state_dir) {
        let mut args = toml_edit::Array::new();
        args.push(MCP_FLAG);
        args.push("--state-dir");
        args.push(path_text(state_dir)?);
        set_value_preserving_decor(server, "args", Value::Array(args));
    }
    if new_entry
        || server
            .get("enabled")
            .is_some_and(|item| item.as_bool() != Some(true))
    {
        set_value_preserving_decor(server, "enabled", Value::from(true));
    }
    Ok(document.to_string())
}

fn set_value_preserving_decor(
    table: &mut dyn toml_edit::TableLike,
    key: &str,
    mut replacement: Value,
) {
    if let Some(existing) = table.get_mut(key) {
        if let Some(value) = existing.as_value() {
            *replacement.decor_mut() = value.decor().clone();
        }
        // 原地替换值，保留键自身的前缀注释；insert 会连同 Key 一起重建。
        *existing = Item::Value(replacement);
    } else {
        table.insert(key, Item::Value(replacement));
    }
}

fn validate_paths(home: &Path, executable: &Path, state_dir: &Path) -> anyhow::Result<PathBuf> {
    validate_launch_paths(executable, state_dir)?;
    if !home.is_absolute() || !home.is_dir() {
        bail!("请选择已存在的绝对 Codex home 目录");
    }
    home.canonicalize().context("无法确认 Codex home 目录")
}

fn validate_launch_paths(executable: &Path, state_dir: &Path) -> anyhow::Result<()> {
    if !executable.is_absolute() || !executable.is_file() {
        bail!("MCP 可执行文件必须是已存在的绝对文件路径");
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::metadata(executable)?.permissions().mode() & 0o111 == 0 {
            bail!("MCP 文件没有执行权限");
        }
    }
    if !state_dir.is_absolute() || (state_dir.exists() && !state_dir.is_dir()) {
        bail!("MCP 状态目录必须是明确的绝对目录路径");
    }
    path_text(executable)?;
    path_text(state_dir)?;
    Ok(())
}

fn path_text(path: &Path) -> anyhow::Result<&str> {
    let text = path.to_str().context("MCP 路径必须是有效 UTF-8")?;
    if text.chars().any(char::is_control) {
        bail!("MCP 路径不能包含控制字符");
    }
    Ok(text)
}

fn reject_symlink(path: &Path) -> anyhow::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            bail!("接入目标不能是符号链接，未修改配置")
        }
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(_) => bail!("无法检查协作配置文件"),
    }
}

fn read_config(path: &Path) -> anyhow::Result<Option<String>> {
    reject_symlink(path)?;
    match std::fs::metadata(path) {
        Ok(metadata) if !metadata.is_file() || metadata.len() > MAX_CONFIG_BYTES => {
            bail!("Codex 配置不是普通文件或超过 4 MiB 上限，未修改");
        }
        Ok(_) => std::fs::read_to_string(path)
            .map(Some)
            .map_err(|_| anyhow::anyhow!("无法读取 Codex 配置，未修改")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(_) => bail!("无法读取 Codex 配置属性，未修改"),
    }
}

fn parse_config(contents: &str) -> anyhow::Result<DocumentMut> {
    // toml_edit 错误可能附带有凭据的源行，不能带到 UI 或日志。
    contents
        .parse::<DocumentMut>()
        .map_err(|_| anyhow::anyhow!("Codex/MCP 配置不是有效 TOML，未修改原文件"))
}

fn server_entry(document: &DocumentMut) -> anyhow::Result<Option<&Item>> {
    match document.get("mcp_servers") {
        None => Ok(None),
        Some(servers) => Ok(servers
            .as_table_like()
            .context("mcp_servers 必须是 TOML 表，未修改配置")?
            .get(SERVER_ID)),
    }
}

fn is_owned(server: &Item) -> bool {
    server
        .as_table_like()
        .and_then(|server| server.get("args"))
        .and_then(Item::as_array)
        .and_then(|args| args.get(0))
        .and_then(Value::as_str)
        == Some(MCP_FLAG)
}

fn has_transport_conflict(server: &Item) -> bool {
    server
        .as_table_like()
        .is_some_and(|table| table.get("url").is_some())
}

fn status_from_document(
    home: &Path,
    document: &DocumentMut,
    executable: &Path,
    state_dir: &Path,
) -> anyhow::Result<RegistrationStatus> {
    let entry = server_entry(document)?;
    let owned = entry.is_some_and(is_owned);
    if entry.is_some_and(has_transport_conflict) {
        return Ok(RegistrationStatus {
            status: "conflict".to_string(),
            message: "同名协作 MCP 包含 HTTP url，未修改配置".to_string(),
            home: home.to_string_lossy().into_owned(),
            config_path: home.join("config.toml").to_string_lossy().into_owned(),
            registered: false,
            owned,
        });
    }
    let current = entry
        .filter(|_| owned)
        .and_then(Item::as_table_like)
        .is_some_and(|server| {
            server.get("command").and_then(Item::as_str) == executable.to_str()
                && server.get("enabled").and_then(Item::as_bool) != Some(false)
                && args_match(server.get("args").and_then(Item::as_array), state_dir)
        });
    let (status, message) = match (entry.is_some(), owned, current) {
        (false, _, _) => ("missing", "尚未接入 Codex"),
        (true, false, _) => ("conflict", "同名 MCP 属于其他配置，未接管"),
        (_, true, false) => ("needs_update", "已找到本工具的 MCP，需要更新路径或启用"),
        (_, true, true) => (
            "registered",
            "已注册协作 MCP；新开 Codex 对话或重新加载 MCP 后可使用",
        ),
    };
    Ok(RegistrationStatus {
        status: status.to_string(),
        message: message.to_string(),
        home: home.to_string_lossy().into_owned(),
        config_path: home.join("config.toml").to_string_lossy().into_owned(),
        registered: current,
        owned,
    })
}

fn args_match(args: Option<&toml_edit::Array>, state_dir: &Path) -> bool {
    args.is_some_and(|args| {
        args.len() == 3
            && args.get(0).and_then(Value::as_str) == Some(MCP_FLAG)
            && args.get(1).and_then(Value::as_str) == Some("--state-dir")
            && args.get(2).and_then(Value::as_str) == state_dir.to_str()
    })
}

fn open_private_new_or_existing(path: &Path) -> anyhow::Result<File> {
    let mut options = OpenOptions::new();
    options.create(true).truncate(false).read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(path).context("无法打开协作接入锁")
}

fn make_private(file: &File) -> std::io::Result<()> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(std::fs::Permissions::from_mode(0o600))?;
    }
    #[cfg(not(unix))]
    let _ = file;
    Ok(())
}

fn backup_config(home: &Path, contents: &str) -> anyhow::Result<PathBuf> {
    let directory = home.join(".alunixa-x-agent-mcp-backups");
    reject_symlink(&directory)?;
    if !directory.exists() {
        let mut builder = std::fs::DirBuilder::new();
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(&directory)
            .context("无法创建协作配置备份目录")?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700))?;
    }
    let path = directory.join(format!(
        "config-{}-{}.toml.bak",
        super::now_ms(),
        uuid::Uuid::new_v4()
    ));
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&path).context("无法创建协作配置备份")?;
    file.write_all(contents.as_bytes())
        .context("无法保存协作配置备份")?;
    file.sync_all()?;
    Ok(path)
}
