use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use anyhow::{Context, anyhow};
use base64::Engine;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};

use crate::settings::{BackendSettings, CodexAiShell, SettingsStore};

const OWNED_HOOK_MARKER: &str = "--alunixa-x-hook";
const HOOK_REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
const EMBEDDING_REQUEST_TIMEOUT: Duration = Duration::from_secs(8);
const MAX_MEMORY_FILE_BYTES: u64 = 512 * 1024;
const MAX_MEMORY_TOTAL_BYTES: u64 = 4 * 1024 * 1024;
const MAX_MEMORY_DEPTH: usize = 4;
const MAX_MEMORY_CHUNKS: usize = 96;
const MAX_MEMORY_CHUNK_CHARS: usize = 1_400;
const MAX_QUERY_CHARS: usize = 4_000;
const MAX_CONTEXT_CHARS: usize = 6_000;
const MAX_EMBEDDING_DIMENSIONS: usize = 8_192;
const EMBEDDING_BATCH_SIZE: usize = 32;
const CACHE_VERSION: u8 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookInstallResult {
    pub path: PathBuf,
    pub installed: usize,
    pub removed: usize,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HookTrustResult {
    pub trusted: usize,
}

#[derive(Debug, Clone)]
struct MemoryChunk {
    cache_key: String,
    path: String,
    text: String,
    tokens: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct EmbeddingCache {
    version: u8,
    scope: String,
    embeddings: HashMap<String, Vec<f32>>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingResponse {
    data: Vec<EmbeddingDatum>,
}

#[derive(Debug, Deserialize)]
struct EmbeddingDatum {
    index: usize,
    embedding: Vec<f32>,
}

pub fn apply_alunixa_x_hooks(
    settings: &BackendSettings,
    launcher_path: &Path,
) -> anyhow::Result<HookInstallResult> {
    apply_alunixa_x_hooks_in_home(
        settings,
        launcher_path,
        &crate::codex_home::default_codex_home_dir(),
    )
}

pub fn apply_alunixa_x_hooks_in_home(
    settings: &BackendSettings,
    launcher_path: &Path,
    codex_home: &Path,
) -> anyhow::Result<HookInstallResult> {
    let path = codex_home.join("hooks.json");
    let mut root = read_hooks_document(&path)?;
    let hooks = hooks_object_mut(&mut root)?;
    let removed = remove_owned_hooks(hooks);
    let mut installed = 0;

    if settings.enhancements_enabled {
        let command = hook_command(launcher_path);
        append_hook(
            hooks,
            "UserPromptSubmit",
            "",
            json!({
                "type": "command",
                "command": command,
                "timeout": 40,
                "statusMessage": "Alunixa X memory retrieval"
            }),
        )?;
        installed += 1;

        #[cfg(windows)]
        {
            for matcher in ["Bash", "shell_command"] {
                append_hook(
                    hooks,
                    "PreToolUse",
                    matcher,
                    json!({
                        "type": "command",
                        "command": hook_command(launcher_path),
                        "timeout": 10,
                        "statusMessage": "Alunixa X AI shell selection"
                    }),
                )?;
                installed += 1;
            }
        }
    }

    let mut bytes = serde_json::to_vec_pretty(&root)?;
    bytes.push(b'\n');
    let existing = std::fs::read(&path).ok();
    if existing.as_deref() != Some(bytes.as_slice()) {
        crate::settings::atomic_write(&path, &bytes)
            .with_context(|| format!("写入 Codex Hook 配置失败：{}", path.display()))?;
    }

    Ok(HookInstallResult {
        path,
        installed,
        removed,
    })
}

pub async fn trust_alunixa_x_hooks(
    saved_app_path: Option<&str>,
) -> anyhow::Result<HookTrustResult> {
    let mut client = HookAppServerClient::connect(saved_app_path).await?;
    let cwd =
        std::env::current_dir().unwrap_or_else(|_| crate::codex_home::default_codex_home_dir());
    let listing = client
        .request(
            "hooks/list",
            Some(json!({
                "cwds": [cwd.to_string_lossy()]
            })),
        )
        .await
        .context("读取 Codex Hook 列表失败")?;
    let hooks = listing
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| entry.get("hooks").and_then(Value::as_array))
        .flatten()
        .filter(|hook| hook.get("source").and_then(Value::as_str) == Some("user"))
        .filter(|hook| {
            hook.get("command")
                .and_then(Value::as_str)
                .is_some_and(is_owned_hook_command)
        })
        .filter_map(|hook| {
            let key = hook.get("key").and_then(Value::as_str)?.trim();
            let hash = hook.get("currentHash").and_then(Value::as_str)?.trim();
            (!key.is_empty() && !hash.is_empty()).then(|| (key.to_string(), hash.to_string()))
        })
        .collect::<Vec<_>>();

    if hooks.is_empty() {
        return Ok(HookTrustResult { trusted: 0 });
    }

    let edits = hooks
        .iter()
        .map(|(key, hash)| {
            json!({
                "keyPath": format!("hooks.state.{}.trusted_hash", toml_key_segment(key)),
                "value": hash,
                "mergeStrategy": "upsert"
            })
        })
        .collect::<Vec<_>>();
    client
        .request(
            "config/batchWrite",
            Some(json!({
                "edits": edits,
                "reloadUserConfig": true
            })),
        )
        .await
        .context("写入 Codex Hook 信任状态失败")?;

    Ok(HookTrustResult {
        trusted: hooks.len(),
    })
}

pub async fn run_hook_from_stdio() -> anyhow::Result<()> {
    let mut input_text = String::new();
    std::io::stdin()
        .read_to_string(&mut input_text)
        .context("读取 Hook 输入失败")?;
    let input = serde_json::from_str::<Value>(&input_text).context("解析 Hook 输入失败");
    let settings = SettingsStore::default().load().unwrap_or_default();
    let launcher_path = std::env::current_exe().context("读取 Alunixa X launcher 路径失败")?;
    let output = match input {
        Ok(input) => match dispatch_hook(&settings, &input, &launcher_path).await {
            Ok(output) => output,
            Err(error) => {
                log_hook_error(&input, &error);
                json!({})
            }
        },
        Err(error) => {
            let _ = crate::diagnostic_log::append_diagnostic_log(
                "codex_hooks.invalid_input",
                json!({ "error": bounded_error(&error) }),
            );
            json!({})
        }
    };
    let mut stdout = std::io::stdout().lock();
    serde_json::to_writer(&mut stdout, &output)?;
    stdout.write_all(b"\n")?;
    stdout.flush()?;
    Ok(())
}

async fn dispatch_hook(
    settings: &BackendSettings,
    input: &Value,
    launcher_path: &Path,
) -> anyhow::Result<Value> {
    match input.get("hook_event_name").and_then(Value::as_str) {
        Some("PreToolUse") => Ok(ai_shell_hook_output(settings, input, launcher_path)),
        Some("UserPromptSubmit") => memory_hook_output(settings, input).await,
        _ => Ok(json!({})),
    }
}

fn ai_shell_hook_output(settings: &BackendSettings, input: &Value, launcher_path: &Path) -> Value {
    #[cfg(not(windows))]
    {
        let _ = settings;
        let _ = input;
        json!({})
    }

    #[cfg(windows)]
    {
        if !matches!(
            input.get("tool_name").and_then(Value::as_str),
            Some("Bash" | "shell_command")
        ) {
            return json!({});
        }
        let Some(tool_input) = input.get("tool_input").and_then(Value::as_object) else {
            return json!({});
        };
        let Some(command) = tool_input.get("command") else {
            return json!({});
        };
        let wrapped = if settings.codex_app_shared_terminal {
            shared_terminal_command_value(input, command, launcher_path)
        } else {
            let selected_shell = available_ai_shell(settings.codex_app_ai_shell);
            wrap_command_value(command, selected_shell)
        };
        let Some(wrapped) = wrapped else {
            return json!({});
        };
        let mut updated_input = Value::Object(tool_input.clone());
        updated_input["command"] = wrapped;
        json!({
            "hookSpecificOutput": {
                "hookEventName": "PreToolUse",
                "updatedInput": updated_input
            }
        })
    }
}

#[cfg(windows)]
fn shared_terminal_command_value(
    input: &Value,
    command: &Value,
    launcher_path: &Path,
) -> Option<Value> {
    let thread_id = input
        .get("session_id")
        .or_else(|| input.get("sessionId"))
        .or_else(|| input.get("thread_id"))
        .or_else(|| input.get("threadId"))
        .or_else(|| input.get("conversation_id"))
        .or_else(|| input.get("conversationId"))
        .and_then(Value::as_str)?
        .trim();
    let cwd = input
        .get("cwd")
        .and_then(Value::as_str)
        .or_else(|| {
            input
                .get("tool_input")
                .and_then(|value| value.get("cwd").or_else(|| value.get("workdir")))
                .and_then(Value::as_str)
        })?
        .trim();
    if thread_id.is_empty() || cwd.is_empty() {
        return None;
    }
    let wrap = |command: &str| {
        crate::shared_terminal::proxy_command(
            launcher_path,
            &uuid::Uuid::new_v4().to_string(),
            thread_id,
            cwd,
            command,
        )
    };
    match command {
        Value::String(command) => wrap(command).map(Value::String),
        Value::Array(commands) => commands
            .iter()
            .map(|command| command.as_str().and_then(&wrap).map(Value::String))
            .collect::<Option<Vec<_>>>()
            .map(Value::Array),
        _ => None,
    }
}

async fn memory_hook_output(settings: &BackendSettings, input: &Value) -> anyhow::Result<Value> {
    let prompt = input
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if prompt.is_empty() {
        return Ok(json!({}));
    }
    let chunks =
        collect_memory_chunks(&crate::codex_home::default_codex_home_dir().join("memories"))?;
    if chunks.is_empty() {
        return Ok(json!({}));
    }

    let bm25 = rank_bm25(prompt, &chunks);
    let (ranked, mode) = if embedding_settings_complete(settings) {
        match rank_with_embeddings(settings, prompt, &chunks).await {
            Ok(ranked) if !ranked.is_empty() => (ranked, "embedding"),
            Ok(_) => (bm25, "bm25"),
            Err(error) => {
                let _ = crate::diagnostic_log::append_diagnostic_log(
                    "codex_hooks.embedding_fallback",
                    json!({ "error": bounded_error(&error) }),
                );
                (bm25, "bm25")
            }
        }
    } else {
        (bm25, "bm25")
    };
    let Some(context) = render_memory_context(&chunks, &ranked, mode) else {
        return Ok(json!({}));
    };

    Ok(json!({
        "hookSpecificOutput": {
            "hookEventName": "UserPromptSubmit",
            "additionalContext": context
        }
    }))
}

fn read_hooks_document(path: &Path) -> anyhow::Result<Value> {
    match std::fs::read_to_string(path) {
        Ok(contents) => {
            let value = serde_json::from_str::<Value>(&contents)
                .with_context(|| format!("Codex Hook 文件不是有效 JSON：{}", path.display()))?;
            if value.is_object() {
                Ok(value)
            } else {
                anyhow::bail!("Codex Hook 文件根节点必须是对象：{}", path.display())
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(json!({ "hooks": {} })),
        Err(error) => Err(error).with_context(|| format!("读取 {} 失败", path.display())),
    }
}

fn hooks_object_mut(root: &mut Value) -> anyhow::Result<&mut serde_json::Map<String, Value>> {
    let object = root.as_object_mut().context("Hook 根节点必须是对象")?;
    if !object.contains_key("hooks") {
        object.insert("hooks".to_string(), json!({}));
    }
    object
        .get_mut("hooks")
        .and_then(Value::as_object_mut)
        .context("hooks 字段必须是对象")
}

fn remove_owned_hooks(hooks: &mut serde_json::Map<String, Value>) -> usize {
    let mut removed = 0;
    let event_names = hooks.keys().cloned().collect::<Vec<_>>();
    for event_name in event_names {
        let Some(groups) = hooks.get_mut(&event_name).and_then(Value::as_array_mut) else {
            continue;
        };
        groups.retain_mut(|group| {
            let Some(handlers) = group.get_mut("hooks").and_then(Value::as_array_mut) else {
                return true;
            };
            let before = handlers.len();
            handlers.retain(|handler| {
                !handler
                    .get("command")
                    .and_then(Value::as_str)
                    .is_some_and(is_owned_hook_command)
            });
            removed += before.saturating_sub(handlers.len());
            !handlers.is_empty()
        });
        if groups.is_empty() {
            hooks.remove(&event_name);
        }
    }
    removed
}

fn append_hook(
    hooks: &mut serde_json::Map<String, Value>,
    event_name: &str,
    matcher: &str,
    handler: Value,
) -> anyhow::Result<()> {
    if !hooks.contains_key(event_name) {
        hooks.insert(event_name.to_string(), Value::Array(Vec::new()));
    }
    let groups = hooks
        .get_mut(event_name)
        .and_then(Value::as_array_mut)
        .with_context(|| format!("{event_name} Hook 配置必须是数组"))?;
    groups.push(json!({
        "matcher": matcher,
        "hooks": [handler]
    }));
    Ok(())
}

fn is_owned_hook_command(command: &str) -> bool {
    command.split_whitespace().any(|part| {
        part.trim_matches(|character| matches!(character, '"' | '\'')) == OWNED_HOOK_MARKER
    })
}

fn hook_command(launcher_path: &Path) -> String {
    #[cfg(windows)]
    {
        format!(
            "\"{}\" {OWNED_HOOK_MARKER}",
            launcher_path.to_string_lossy().replace('"', "")
        )
    }
    #[cfg(not(windows))]
    {
        format!(
            "{} {OWNED_HOOK_MARKER}",
            shell_quote(&launcher_path.to_string_lossy())
        )
    }
}

#[cfg(not(windows))]
fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

#[cfg(windows)]
fn available_ai_shell(selected: CodexAiShell) -> CodexAiShell {
    match selected {
        CodexAiShell::Pwsh if executable_on_path("pwsh.exe") => CodexAiShell::Pwsh,
        CodexAiShell::PowerShell if executable_on_path("powershell.exe") => {
            CodexAiShell::PowerShell
        }
        CodexAiShell::Pwsh => CodexAiShell::PowerShell,
        CodexAiShell::PowerShell if executable_on_path("pwsh.exe") => CodexAiShell::Pwsh,
        CodexAiShell::PowerShell => CodexAiShell::PowerShell,
    }
}

#[cfg(windows)]
fn executable_on_path(name: &str) -> bool {
    std::env::var_os("PATH")
        .into_iter()
        .flat_map(|paths| std::env::split_paths(&paths).collect::<Vec<_>>())
        .any(|path| path.join(name).is_file())
        || (name.eq_ignore_ascii_case("powershell.exe")
            && std::env::var_os("SystemRoot")
                .map(PathBuf::from)
                .map(|root| {
                    root.join("System32")
                        .join("WindowsPowerShell")
                        .join("v1.0")
                        .join(name)
                        .is_file()
                })
                .unwrap_or(false))
}

#[cfg(windows)]
fn wrap_command_value(command: &Value, shell: CodexAiShell) -> Option<Value> {
    match command {
        Value::String(command) => wrap_powershell_command(command, shell).map(Value::String),
        Value::Array(commands) => {
            let wrapped = commands
                .iter()
                .map(|command| {
                    command
                        .as_str()
                        .and_then(|command| wrap_powershell_command(command, shell))
                        .map(Value::String)
                })
                .collect::<Option<Vec<_>>>()?;
            Some(Value::Array(wrapped))
        }
        _ => None,
    }
}

#[cfg(windows)]
fn wrap_powershell_command(command: &str, shell: CodexAiShell) -> Option<String> {
    if command.trim().is_empty() {
        return None;
    }
    let encoded = base64::engine::general_purpose::STANDARD.encode(
        command
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    let executable = match shell {
        CodexAiShell::PowerShell => "powershell.exe",
        CodexAiShell::Pwsh => "pwsh.exe",
    };
    Some(format!(
        "{executable} -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {encoded}"
    ))
}

fn collect_memory_chunks(root: &Path) -> anyhow::Result<Vec<MemoryChunk>> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    collect_memory_files(root, root, 0, &mut files)?;
    files.sort();

    let mut total_bytes = 0;
    let mut chunks = Vec::new();
    for path in files {
        let metadata = std::fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink()
            || metadata.len() > MAX_MEMORY_FILE_BYTES
            || total_bytes + metadata.len() > MAX_MEMORY_TOTAL_BYTES
        {
            continue;
        }
        let bytes = std::fs::read(&path)?;
        let Ok(text) = String::from_utf8(bytes) else {
            continue;
        };
        total_bytes += metadata.len();
        let relative = path
            .strip_prefix(root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        for text in chunk_memory_text(&text) {
            if chunks.len() >= MAX_MEMORY_CHUNKS {
                return Ok(chunks);
            }
            let cache_key = sha256_hex(text.as_bytes());
            chunks.push(MemoryChunk {
                cache_key,
                path: relative.clone(),
                tokens: tokenize(&text),
                text,
            });
        }
    }
    Ok(chunks)
}

fn collect_memory_files(
    root: &Path,
    directory: &Path,
    depth: usize,
    files: &mut Vec<PathBuf>,
) -> anyhow::Result<()> {
    if depth > MAX_MEMORY_DEPTH {
        return Ok(());
    }
    let mut entries = std::fs::read_dir(directory)?
        .filter_map(Result::ok)
        .collect::<Vec<_>>();
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() {
            continue;
        }
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with('.') && path != root {
            continue;
        }
        if metadata.is_dir() {
            collect_memory_files(root, &path, depth + 1, files)?;
            continue;
        }
        if metadata.is_file() && is_memory_text_file(&path) {
            files.push(path);
        }
    }
    Ok(())
}

fn is_memory_text_file(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| {
            matches!(
                extension.to_ascii_lowercase().as_str(),
                "md" | "markdown" | "txt" | "rst"
            )
        })
        .unwrap_or(false)
}

fn chunk_memory_text(text: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for paragraph in text
        .split("\n\n")
        .map(str::trim)
        .filter(|paragraph| !paragraph.is_empty())
    {
        if paragraph.chars().count() > MAX_MEMORY_CHUNK_CHARS {
            if !current.is_empty() {
                chunks.push(std::mem::take(&mut current));
            }
            chunks.extend(split_at_char_limit(paragraph, MAX_MEMORY_CHUNK_CHARS));
            continue;
        }
        let separator = if current.is_empty() { 0 } else { 2 };
        if current.chars().count() + separator + paragraph.chars().count() > MAX_MEMORY_CHUNK_CHARS
        {
            chunks.push(std::mem::take(&mut current));
        }
        if !current.is_empty() {
            current.push_str("\n\n");
        }
        current.push_str(paragraph);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn split_at_char_limit(text: &str, limit: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let chars = text.chars().collect::<Vec<_>>();
    for part in chars.chunks(limit) {
        let chunk = part.iter().collect::<String>().trim().to_string();
        if !chunk.is_empty() {
            chunks.push(chunk);
        }
    }
    chunks
}

fn tokenize(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut ascii = String::new();
    let mut cjk_run = Vec::new();
    let flush_ascii = |tokens: &mut Vec<String>, ascii: &mut String| {
        if !ascii.is_empty() {
            tokens.push(std::mem::take(ascii));
        }
    };
    let flush_cjk = |tokens: &mut Vec<String>, run: &mut Vec<char>| {
        if run.is_empty() {
            return;
        }
        for character in run.iter() {
            tokens.push(character.to_string());
        }
        for pair in run.windows(2) {
            tokens.push(pair.iter().collect());
        }
        run.clear();
    };

    for character in text.chars() {
        if character.is_ascii_alphanumeric() || character == '_' {
            flush_cjk(&mut tokens, &mut cjk_run);
            ascii.push(character.to_ascii_lowercase());
        } else if is_cjk(character) {
            flush_ascii(&mut tokens, &mut ascii);
            cjk_run.push(character);
        } else {
            flush_ascii(&mut tokens, &mut ascii);
            flush_cjk(&mut tokens, &mut cjk_run);
        }
    }
    flush_ascii(&mut tokens, &mut ascii);
    flush_cjk(&mut tokens, &mut cjk_run);
    tokens
}

fn is_cjk(character: char) -> bool {
    matches!(
        character as u32,
        0x3400..=0x4dbf
            | 0x4e00..=0x9fff
            | 0xf900..=0xfaff
            | 0x20000..=0x2fa1f
    )
}

fn rank_bm25(query: &str, chunks: &[MemoryChunk]) -> Vec<(usize, f32)> {
    let query_terms = tokenize(&truncate_chars(query, MAX_QUERY_CHARS))
        .into_iter()
        .collect::<HashSet<_>>();
    if query_terms.is_empty() || chunks.is_empty() {
        return Vec::new();
    }
    let average_length = chunks
        .iter()
        .map(|chunk| chunk.tokens.len() as f32)
        .sum::<f32>()
        / chunks.len() as f32;
    let mut document_frequency = HashMap::<String, usize>::new();
    for chunk in chunks {
        let terms = chunk.tokens.iter().collect::<HashSet<_>>();
        for term in terms {
            *document_frequency.entry(term.clone()).or_default() += 1;
        }
    }
    let mut ranked = Vec::new();
    for (index, chunk) in chunks.iter().enumerate() {
        let mut frequencies = HashMap::<&str, usize>::new();
        for token in &chunk.tokens {
            *frequencies.entry(token).or_default() += 1;
        }
        let mut score = 0.0f32;
        for term in &query_terms {
            let term_frequency = frequencies.get(term.as_str()).copied().unwrap_or(0) as f32;
            if term_frequency == 0.0 {
                continue;
            }
            let document_count = chunks.len() as f32;
            let frequency = document_frequency.get(term).copied().unwrap_or(0) as f32;
            let inverse_document_frequency =
                ((document_count - frequency + 0.5) / (frequency + 0.5) + 1.0).ln();
            let k1 = 1.5;
            let b = 0.75;
            let length_ratio = if average_length > 0.0 {
                chunk.tokens.len() as f32 / average_length
            } else {
                1.0
            };
            score += inverse_document_frequency * term_frequency * (k1 + 1.0)
                / (term_frequency + k1 * (1.0 - b + b * length_ratio));
        }
        if score.is_finite() && score > 0.0 {
            ranked.push((index, score));
        }
    }
    sort_ranked(&mut ranked);
    ranked.truncate(5);
    ranked
}

async fn rank_with_embeddings(
    settings: &BackendSettings,
    query: &str,
    chunks: &[MemoryChunk],
) -> anyhow::Result<Vec<(usize, f32)>> {
    let endpoint = embeddings_endpoint(&settings.codex_app_memory_embedding_base_url)?;
    let model = settings.codex_app_memory_embedding_model.trim();
    let api_key = settings.codex_app_memory_embedding_api_key.trim();
    let scope = sha256_hex(
        format!(
            "{}\0{}",
            settings.codex_app_memory_embedding_base_url, model
        )
        .as_bytes(),
    );
    let cache_path = embedding_cache_path();
    let mut cache = load_embedding_cache(&cache_path);
    if cache.version != CACHE_VERSION || cache.scope != scope {
        cache = EmbeddingCache {
            version: CACHE_VERSION,
            scope,
            embeddings: HashMap::new(),
        };
    }

    let client = reqwest::Client::builder()
        .timeout(EMBEDDING_REQUEST_TIMEOUT)
        .build()
        .context("创建嵌入请求客户端失败")?;
    let query_text = truncate_chars(query, MAX_QUERY_CHARS);
    let query_vector = fetch_embeddings(&client, &endpoint, api_key, model, &[query_text.as_str()])
        .await?
        .into_iter()
        .next()
        .context("嵌入接口未返回查询向量")?;

    let missing = chunks
        .iter()
        .filter(|chunk| !cache.embeddings.contains_key(&chunk.cache_key))
        .collect::<Vec<_>>();
    for batch in missing.chunks(EMBEDDING_BATCH_SIZE) {
        let inputs = batch
            .iter()
            .map(|chunk| chunk.text.as_str())
            .collect::<Vec<_>>();
        let embeddings = fetch_embeddings(&client, &endpoint, api_key, model, &inputs).await?;
        if embeddings.len() != batch.len() {
            anyhow::bail!("嵌入接口返回的文档向量数量不匹配");
        }
        for (chunk, embedding) in batch.iter().zip(embeddings) {
            cache.embeddings.insert(chunk.cache_key.clone(), embedding);
        }
    }
    let active_keys = chunks
        .iter()
        .map(|chunk| chunk.cache_key.as_str())
        .collect::<HashSet<_>>();
    cache
        .embeddings
        .retain(|key, _| active_keys.contains(key.as_str()));
    save_embedding_cache(&cache_path, &cache)?;

    let mut ranked = chunks
        .iter()
        .enumerate()
        .filter_map(|(index, chunk)| {
            let embedding = cache.embeddings.get(&chunk.cache_key)?;
            let score = cosine_similarity(&query_vector, embedding)?;
            (score > 0.0).then_some((index, score))
        })
        .collect::<Vec<_>>();
    sort_ranked(&mut ranked);
    ranked.truncate(5);
    Ok(ranked)
}

async fn fetch_embeddings(
    client: &reqwest::Client,
    endpoint: &Url,
    api_key: &str,
    model: &str,
    inputs: &[&str],
) -> anyhow::Result<Vec<Vec<f32>>> {
    let mut request = client.post(endpoint.clone()).json(&json!({
        "model": model,
        "input": inputs
    }));
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }
    let response = request.send().await.context("嵌入接口连接失败")?;
    let status = response.status();
    if !status.is_success() {
        anyhow::bail!("嵌入接口返回 HTTP {}", status.as_u16());
    }
    let response = response
        .json::<EmbeddingResponse>()
        .await
        .context("嵌入接口响应格式无效")?;
    let mut ordered = vec![None; inputs.len()];
    for datum in response.data {
        if datum.index >= ordered.len()
            || datum.embedding.is_empty()
            || datum.embedding.len() > MAX_EMBEDDING_DIMENSIONS
            || datum.embedding.iter().any(|value| !value.is_finite())
        {
            anyhow::bail!("嵌入接口返回了无效向量");
        }
        ordered[datum.index] = Some(datum.embedding);
    }
    ordered
        .into_iter()
        .map(|embedding| embedding.context("嵌入接口缺少向量"))
        .collect()
}

fn embeddings_endpoint(base_url: &str) -> anyhow::Result<Url> {
    let mut url = Url::parse(base_url.trim()).context("记忆嵌入 Base URL 无效")?;
    if !matches!(url.scheme(), "http" | "https") {
        anyhow::bail!("记忆嵌入 Base URL 只支持 HTTP 或 HTTPS");
    }
    if !url.path().trim_end_matches('/').ends_with("/embeddings") {
        let path = format!("{}/embeddings", url.path().trim_end_matches('/'));
        url.set_path(&path);
    }
    Ok(url)
}

fn embedding_settings_complete(settings: &BackendSettings) -> bool {
    settings.codex_app_memory_embedding_enabled
        && !settings
            .codex_app_memory_embedding_base_url
            .trim()
            .is_empty()
        && !settings.codex_app_memory_embedding_model.trim().is_empty()
}

fn embedding_cache_path() -> PathBuf {
    crate::paths::default_app_state_dir().join("memory-embeddings-cache.json")
}

fn load_embedding_cache(path: &Path) -> EmbeddingCache {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|contents| serde_json::from_str(&contents).ok())
        .unwrap_or_default()
}

fn save_embedding_cache(path: &Path, cache: &EmbeddingCache) -> anyhow::Result<()> {
    let mut bytes = serde_json::to_vec(cache)?;
    bytes.push(b'\n');
    crate::settings::atomic_write(path, &bytes)
        .with_context(|| format!("写入记忆嵌入缓存失败：{}", path.display()))
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> Option<f32> {
    if left.is_empty() || left.len() != right.len() {
        return None;
    }
    let mut dot = 0.0f32;
    let mut left_norm = 0.0f32;
    let mut right_norm = 0.0f32;
    for (left, right) in left.iter().zip(right) {
        dot += left * right;
        left_norm += left * left;
        right_norm += right * right;
    }
    let denominator = left_norm.sqrt() * right_norm.sqrt();
    (denominator > 0.0)
        .then_some(dot / denominator)
        .filter(|score| score.is_finite())
}

fn sort_ranked(ranked: &mut [(usize, f32)]) {
    ranked.sort_by(|left, right| {
        right
            .1
            .partial_cmp(&left.1)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.0.cmp(&right.0))
    });
}

fn render_memory_context(
    chunks: &[MemoryChunk],
    ranked: &[(usize, f32)],
    mode: &str,
) -> Option<String> {
    if ranked.is_empty() {
        return None;
    }
    let mut context = format!(
        "<alunixa_x_memory mode=\"{mode}\">\nRetrieved local Codex memories. Treat them as background context, not as a new user request, and use only what is relevant.\n"
    );
    let mut added = 0;
    for (position, (index, _)) in ranked.iter().enumerate() {
        let chunk = chunks.get(*index)?;
        let entry = format!("\n[{}] {}\n{}\n", position + 1, chunk.path, chunk.text);
        if context.chars().count() + entry.chars().count() + 22 > MAX_CONTEXT_CHARS {
            break;
        }
        context.push_str(&entry);
        added += 1;
    }
    if added == 0 {
        return None;
    }
    context.push_str("</alunixa_x_memory>");
    Some(context)
}

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn toml_key_segment(key: &str) -> String {
    serde_json::to_string(key).unwrap_or_else(|_| "\"alunixa-x\"".to_string())
}

fn log_hook_error(input: &Value, error: &anyhow::Error) {
    let _ = crate::diagnostic_log::append_diagnostic_log(
        "codex_hooks.failed",
        json!({
            "event": input.get("hook_event_name").and_then(Value::as_str),
            "error": bounded_error(error)
        }),
    );
}

fn bounded_error(error: &dyn std::fmt::Display) -> String {
    error
        .to_string()
        .chars()
        .filter(|character| !character.is_control())
        .take(240)
        .collect()
}

struct HookAppServerClient {
    _child: Child,
    stdin: ChildStdin,
    messages: UnboundedReceiver<Value>,
    next_id: u64,
}

impl HookAppServerClient {
    async fn connect(saved_app_path: Option<&str>) -> anyhow::Result<Self> {
        let executable = crate::official_remote::find_codex_cli_executable(saved_app_path)
            .context("未找到支持 Hook 的 Codex CLI")?;
        let mut command = Command::new(&executable);
        command
            .arg("app-server")
            .arg("--stdio")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(crate::windows_create_no_window());
        let mut child = command
            .spawn()
            .with_context(|| format!("启动 Codex app-server 失败：{}", executable.display()))?;
        let stdin = child
            .stdin
            .take()
            .context("Codex app-server stdin 不可用")?;
        let stdout = child
            .stdout
            .take()
            .context("Codex app-server stdout 不可用")?;
        let (sender, messages) = unbounded_channel();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            loop {
                match lines.next_line().await {
                    Ok(Some(line)) => {
                        if let Ok(message) = serde_json::from_str::<Value>(&line)
                            && sender.send(message).is_err()
                        {
                            break;
                        }
                    }
                    Ok(None) | Err(_) => break,
                }
            }
        });
        let mut client = Self {
            _child: child,
            stdin,
            messages,
            next_id: 1,
        };
        client
            .request(
                "initialize",
                Some(json!({
                    "clientInfo": {
                        "name": "Alunixa X Hook Manager",
                        "title": "Alunixa X",
                        "version": crate::version::VERSION
                    },
                    "capabilities": {
                        "experimentalApi": true,
                        "requestAttestation": false,
                        "optOutNotificationMethods": []
                    }
                })),
            )
            .await
            .context("初始化 Codex Hook app-server 失败")?;
        Ok(client)
    }

    async fn request(&mut self, method: &str, params: Option<Value>) -> anyhow::Result<Value> {
        let id = self.next_id;
        self.next_id += 1;
        let mut request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method
        });
        if let Some(params) = params {
            request["params"] = params;
        }
        let mut bytes = serde_json::to_vec(&request)?;
        bytes.push(b'\n');
        self.stdin
            .write_all(&bytes)
            .await
            .context("写入 Codex app-server 请求失败")?;
        self.stdin.flush().await?;

        tokio::time::timeout(HOOK_REQUEST_TIMEOUT, async {
            loop {
                let message = self
                    .messages
                    .recv()
                    .await
                    .context("Codex app-server 已关闭")?;
                if message.get("id").and_then(Value::as_u64) != Some(id) {
                    continue;
                }
                if let Some(error) = message.get("error") {
                    let code = error
                        .get("code")
                        .and_then(Value::as_i64)
                        .unwrap_or_default();
                    let message = error
                        .get("message")
                        .and_then(Value::as_str)
                        .unwrap_or("未知 app-server 错误");
                    return Err(anyhow!("app-server {code}: {}", bounded_message(message)));
                }
                return Ok(message.get("result").cloned().unwrap_or(Value::Null));
            }
        })
        .await
        .map_err(|_| anyhow!("{method} 请求超时"))?
    }
}

fn bounded_message(message: &str) -> String {
    message
        .split_whitespace()
        .take(32)
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn hook_file_merge_preserves_user_hooks_and_replaces_owned_hooks() {
        let temp = tempdir().unwrap();
        let home = temp.path().join(".codex");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(
            home.join("hooks.json"),
            r#"{
  "hooks": {
    "UserPromptSubmit": [
      {
        "matcher": "",
        "hooks": [
          {"type":"command","command":"user-memory-tool"},
          {"type":"command","command":"old.exe --alunixa-x-hook"}
        ]
      }
    ]
  },
  "custom": true
}"#,
        )
        .unwrap();
        let settings = BackendSettings::default();

        let result = apply_alunixa_x_hooks_in_home(
            &settings,
            Path::new(r"C:\Program Files\Alunixa X\alunixa-x.exe"),
            &home,
        )
        .unwrap();
        let written: Value =
            serde_json::from_str(&std::fs::read_to_string(result.path).unwrap()).unwrap();
        let text = serde_json::to_string(&written).unwrap();

        assert!(written["custom"].as_bool().unwrap());
        assert!(text.contains("user-memory-tool"));
        #[cfg(windows)]
        {
            assert_eq!(written["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
            assert!(text.contains("shell_command"));
            assert!(text.contains("Bash"));
            assert_eq!(result.installed, 3);
        }
        #[cfg(not(windows))]
        {
            assert!(written["hooks"].get("PreToolUse").is_none());
            assert_eq!(result.installed, 1);
        }
        assert_eq!(text.matches(OWNED_HOOK_MARKER).count(), result.installed);
        assert_eq!(result.removed, 1);
    }

    #[test]
    fn disabled_enhancements_remove_only_owned_hooks() {
        let temp = tempdir().unwrap();
        let home = temp.path().join(".codex");
        std::fs::create_dir_all(&home).unwrap();
        std::fs::write(
            home.join("hooks.json"),
            r#"{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"keep"},{"type":"command","command":"old --alunixa-x-hook"}]}]}}"#,
        )
        .unwrap();
        let settings = BackendSettings {
            enhancements_enabled: false,
            ..BackendSettings::default()
        };

        let result =
            apply_alunixa_x_hooks_in_home(&settings, Path::new("launcher"), &home).unwrap();
        let text = std::fs::read_to_string(result.path).unwrap();

        assert!(text.contains("\"command\": \"keep\""));
        assert!(!text.contains(OWNED_HOOK_MARKER));
        assert_eq!(result.installed, 0);
        assert_eq!(result.removed, 1);
    }

    #[test]
    fn bm25_matches_english_and_chinese_memory_terms() {
        let chunks = vec![
            memory_chunk(
                "api.md",
                "Use the provider API fallback when OAuth is unavailable.",
            ),
            memory_chunk("release.md", "发布版本必须使用 GitHub Actions 构建。"),
            memory_chunk("other.md", "Unrelated desktop preferences."),
        ];

        let english = rank_bm25("provider API", &chunks);
        let chinese = rank_bm25("发布版本构建", &chunks);

        assert_eq!(english.first().map(|item| item.0), Some(0));
        assert_eq!(chinese.first().map(|item| item.0), Some(1));
    }

    #[test]
    fn memory_context_is_bounded_and_labels_retrieval_mode() {
        let chunks = (0..5)
            .map(|index| {
                memory_chunk(
                    &format!("memory-{index}.md"),
                    &"a".repeat(MAX_MEMORY_CHUNK_CHARS),
                )
            })
            .collect::<Vec<_>>();
        let ranked = (0..chunks.len())
            .map(|index| (index, 1.0))
            .collect::<Vec<_>>();
        let context = render_memory_context(&chunks, &ranked, "bm25").unwrap();

        assert!(context.contains("mode=\"bm25\""));
        assert!(context.chars().count() <= MAX_CONTEXT_CHARS);
    }

    #[test]
    fn embeddings_endpoint_appends_standard_path_once() {
        assert_eq!(
            embeddings_endpoint("https://example.test/v1")
                .unwrap()
                .as_str(),
            "https://example.test/v1/embeddings"
        );
        assert_eq!(
            embeddings_endpoint("https://example.test/v1/embeddings")
                .unwrap()
                .as_str(),
            "https://example.test/v1/embeddings"
        );
    }

    #[cfg(windows)]
    #[test]
    fn powershell_wrapper_round_trips_multiline_command() {
        let command = "Write-Output \"你好\"\nGet-Location";
        let wrapped = wrap_powershell_command(command, CodexAiShell::Pwsh).unwrap();
        let encoded = wrapped.split_whitespace().last().unwrap();
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        let utf16 = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect::<Vec<_>>();

        assert_eq!(String::from_utf16(&utf16).unwrap(), command);
        assert!(wrapped.starts_with("pwsh.exe "));
    }

    #[cfg(windows)]
    #[test]
    fn shared_terminal_hook_routes_current_shell_command_through_launcher() {
        let settings = BackendSettings {
            codex_app_shared_terminal: true,
            ..BackendSettings::default()
        };
        let input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "shell_command",
            "conversation_id": "thread-1",
            "tool_input": {
                "command": "Write-Output 'hello'",
                "workdir": r"D:\work dir"
            }
        });

        let output = ai_shell_hook_output(
            &settings,
            &input,
            Path::new(r"C:\Program Files\Alunixa X\alunixa-x.exe"),
        );
        let command = output["hookSpecificOutput"]["updatedInput"]["command"]
            .as_str()
            .unwrap();

        assert!(command.contains("--alunixa-x-shared-terminal"));
        assert!(!command.contains("Write-Output 'hello'"));
        assert!(!command.contains("-NonInteractive"));
    }

    #[cfg(windows)]
    #[test]
    fn shared_terminal_hook_keeps_legacy_bash_compatibility() {
        let settings = BackendSettings {
            codex_app_shared_terminal: true,
            ..BackendSettings::default()
        };
        let input = json!({
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "session_id": "thread-legacy",
            "cwd": r"D:\legacy",
            "tool_input": { "command": "Write-Output legacy" }
        });

        let output = ai_shell_hook_output(&settings, &input, Path::new("launcher.exe"));

        assert!(
            output["hookSpecificOutput"]["updatedInput"]["command"]
                .as_str()
                .unwrap()
                .contains("--alunixa-x-shared-terminal")
        );
    }

    fn memory_chunk(path: &str, text: &str) -> MemoryChunk {
        MemoryChunk {
            cache_key: sha256_hex(text.as_bytes()),
            path: path.to_string(),
            text: text.to_string(),
            tokens: tokenize(text),
        }
    }
}
