use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::Context;
use base64::Engine as _;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const DEFAULT_IMAGE_MODEL: &str = "gpt-image-2";
const MAX_IMAGE_VARIANTS: u64 = 4;

pub async fn run_imagegen_mcp_from_stdio() -> anyhow::Result<()> {
    let stdin = tokio::io::stdin();
    let mut lines = BufReader::new(stdin).lines();
    let mut stdout = tokio::io::stdout();
    while let Some(line) = lines.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(line) {
            Ok(request) => request,
            Err(error) => {
                write_message(
                    &mut stdout,
                    &json_rpc_error(Value::Null, -32700, format!("JSON 解析失败：{error}")),
                )
                .await?;
                continue;
            }
        };
        let Some(id) = request.get("id").cloned() else {
            continue;
        };
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let response = match method {
            "initialize" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "protocolVersion": request.pointer("/params/protocolVersion").cloned().unwrap_or_else(|| json!("2025-06-18")),
                    "capabilities": { "tools": { "listChanged": false } },
                    "serverInfo": {
                        "name": "alunixa-x-imagegen",
                        "title": "Alunixa X Image Generation",
                        "version": crate::version::VERSION
                    }
                }
            }),
            "ping" => json!({ "jsonrpc": "2.0", "id": id, "result": {} }),
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": { "tools": [image_gen_tool_definition()] }
            }),
            "tools/call" => {
                let name = request
                    .pointer("/params/name")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                if name != "image_gen" {
                    json_rpc_error(id, -32602, format!("未知工具：{name}"))
                } else {
                    let arguments = request
                        .pointer("/params/arguments")
                        .cloned()
                        .unwrap_or_else(|| json!({}));
                    match execute_image_gen(&arguments).await {
                        Ok(result) => json!({ "jsonrpc": "2.0", "id": id, "result": result }),
                        Err(error) => json!({
                            "jsonrpc": "2.0",
                            "id": id,
                            "result": {
                                "isError": true,
                                "content": [{ "type": "text", "text": format!("Alunixa X image_gen 执行失败：{error:#}") }]
                            }
                        }),
                    }
                }
            }
            _ => json_rpc_error(id, -32601, format!("不支持的方法：{method}")),
        };
        write_message(&mut stdout, &response).await?;
    }
    Ok(())
}

fn image_gen_tool_definition() -> Value {
    json!({
        "name": "image_gen",
        "title": "Generate or edit an image",
        "description": "Generate or edit raster images with the user's configured image model. Omit model and profile_id to use the first saved image model (the current default); configuration is reloaded on every call. With no image models configured, the active Alunixa X provider is used. Generated files are saved under CODEX_HOME/generated_images.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "prompt": { "type": "string", "description": "Detailed image generation or editing prompt." },
                "image_paths": {
                    "type": "array",
                    "items": { "type": "string" },
                    "description": "Optional local image paths. When present, the Images edits endpoint is used."
                },
                "mask_path": { "type": "string", "description": "Optional local mask image path for editing." },
                "model": { "type": "string", "description": "Optional configured model name. Omit to use the user's current default image model." },
                "profile_id": { "type": "string", "description": "Optional image configuration ID, to distinguish configurations with the same model name." },
                "size": { "type": "string", "description": "Requested image size, for example 1024x1024 or auto." },
                "quality": { "type": "string", "description": "Requested quality, for example low, medium, high, or auto." },
                "background": { "type": "string", "description": "Background mode when supported, for example transparent, opaque, or auto." },
                "output_format": { "type": "string", "description": "Output format when supported, for example png, jpeg, or webp." },
                "output_compression": { "type": "integer", "minimum": 0, "maximum": 100 },
                "input_fidelity": { "type": "string", "description": "Input fidelity for edit-capable image models when supported." },
                "n": { "type": "integer", "minimum": 1, "maximum": MAX_IMAGE_VARIANTS, "default": 1 }
            },
            "required": ["prompt"],
            "additionalProperties": false
        },
        "annotations": {
            "readOnlyHint": false,
            "destructiveHint": false,
            "idempotentHint": false,
            "openWorldHint": true
        }
    })
}

async fn execute_image_gen(arguments: &Value) -> anyhow::Result<Value> {
    execute_image_gen_with_store(
        arguments,
        &crate::settings::SettingsStore::default(),
        &generated_image_output_dir()?,
    )
    .await
}

async fn execute_image_gen_with_store(
    arguments: &Value,
    store: &crate::settings::SettingsStore,
    output_dir: &Path,
) -> anyhow::Result<Value> {
    let prompt = arguments
        .get("prompt")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|prompt| !prompt.is_empty())
        .context("prompt 不能为空")?;
    let settings = store
        .load()
        .map_err(|_| anyhow::anyhow!("读取生图模型配置失败，未回退或发送请求"))?;
    let target = image_request_target(arguments, &settings.image_models)?;
    let image_paths = arguments
        .get("image_paths")
        .and_then(Value::as_array)
        .map(|paths| {
            paths
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|path| !path.is_empty())
                .map(PathBuf::from)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let client = reqwest::Client::builder()
        .user_agent(format!("AlunixaX-ImageGen/{}", crate::version::VERSION))
        .timeout(std::time::Duration::from_secs(900))
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let payload = send_image_request(&client, arguments, prompt, &image_paths, &target).await?;
    let images = extract_image_outputs(&client, &payload).await?;
    if images.is_empty() {
        anyhow::bail!("图片端点成功但响应中没有 b64_json、image 或 url 输出");
    }

    save_image_outputs(
        output_dir,
        arguments,
        prompt,
        &target.model,
        &payload,
        images,
    )
}

struct ImageRequestTarget {
    base_url: String,
    api_key: Option<String>,
    model: String,
}

fn image_request_target(
    arguments: &Value,
    models: &[crate::image_models::ImageModel],
) -> anyhow::Result<ImageRequestTarget> {
    let model = string_argument(arguments, "model");
    match crate::image_models::select_model(
        models,
        string_argument(arguments, "profile_id"),
        model,
    )? {
        Some(profile) => Ok(ImageRequestTarget {
            base_url: crate::image_models::normalize_base_url(&profile.base_url)?,
            api_key: Some(profile.api_key.clone()),
            model: profile.model.clone(),
        }),
        None => Ok(ImageRequestTarget {
            base_url: format!("{}/v1", helper_url()?),
            api_key: None,
            model: model.unwrap_or(DEFAULT_IMAGE_MODEL).to_string(),
        }),
    }
}

async fn send_image_request(
    client: &reqwest::Client,
    arguments: &Value,
    prompt: &str,
    image_paths: &[PathBuf],
    target: &ImageRequestTarget,
) -> anyhow::Result<Value> {
    let endpoint = format!(
        "{}/images/{}",
        target.base_url,
        if image_paths.is_empty() {
            "generations"
        } else {
            "edits"
        }
    );
    let request = if image_paths.is_empty() {
        client
            .post(&endpoint)
            .json(&image_generation_payload(arguments, prompt, &target.model))
    } else {
        client
            .post(&endpoint)
            .multipart(image_edit_form(arguments, prompt, image_paths, &target.model).await?)
    };
    // Apply credentials only to this POST, never to the shared client's image downloads.
    let request = if let Some(key) = &target.api_key {
        request.bearer_auth(key)
    } else {
        request
    };
    let response = request
        .send()
        .await
        .map_err(|_| anyhow::anyhow!("连接生图 API 失败，未自动重试或切换模型"))?;
    let status = response.status();
    if !status.is_success() {
        // Upstream bodies can echo credentials or prompts; do not forward them to MCP.
        anyhow::bail!(
            "生图 API 返回 HTTP {}，请检查生图模型配置；未自动重试",
            status.as_u16()
        );
    }
    let body = response
        .bytes()
        .await
        .map_err(|_| anyhow::anyhow!("读取图片端点响应失败"))?;
    serde_json::from_slice(&body).map_err(|_| anyhow::anyhow!("图片端点未返回有效 JSON"))
}

fn save_image_outputs(
    output_dir: &Path,
    arguments: &Value,
    prompt: &str,
    model: &str,
    payload: &Value,
    images: Vec<ImageOutput>,
) -> anyhow::Result<Value> {
    std::fs::create_dir_all(output_dir)?;
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis();
    let mut content = Vec::new();
    let mut saved_paths = Vec::new();
    for (index, image) in images.into_iter().enumerate() {
        let extension = extension_for_mime(&image.mime_type);
        let path = unique_output_path(&output_dir, stamp, index + 1, extension);
        std::fs::write(&path, &image.bytes)
            .with_context(|| format!("写入生成图片失败：{}", path.display()))?;
        saved_paths.push(path.to_string_lossy().to_string());
        content.push(json!({
            "type": "image",
            "data": base64::engine::general_purpose::STANDARD.encode(&image.bytes),
            "mimeType": image.mime_type
        }));
    }
    let revised_prompts = payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("revised_prompt").and_then(Value::as_str))
        .collect::<Vec<_>>();
    let summary = if revised_prompts.is_empty() {
        format!(
            "已生成并保存 {} 张图片：\n{}",
            saved_paths.len(),
            saved_paths.join("\n")
        )
    } else {
        format!(
            "已生成并保存 {} 张图片：\n{}\n修订后的提示词：\n{}",
            saved_paths.len(),
            saved_paths.join("\n"),
            revised_prompts.join("\n")
        )
    };
    content.insert(0, json!({ "type": "text", "text": summary }));
    Ok(json!({
        "content": content,
        "structuredContent": {
            "paths": saved_paths,
            "prompt": prompt,
            "model": model,
            "endpoint": if arguments.get("image_paths").and_then(Value::as_array).is_none_or(Vec::is_empty) { "images/generations" } else { "images/edits" }
        }
    }))
}

fn image_generation_payload(arguments: &Value, prompt: &str, model: &str) -> Value {
    let mut payload = serde_json::Map::new();
    payload.insert("prompt".to_string(), Value::String(prompt.to_string()));
    payload.insert("model".to_string(), Value::String(model.to_string()));
    payload.insert(
        "n".to_string(),
        Value::Number(
            arguments
                .get("n")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, MAX_IMAGE_VARIANTS)
                .into(),
        ),
    );
    for key in [
        "size",
        "quality",
        "background",
        "output_format",
        "input_fidelity",
    ] {
        if let Some(value) = string_argument(arguments, key) {
            payload.insert(key.to_string(), Value::String(value.to_string()));
        }
    }
    if let Some(value) = arguments.get("output_compression").and_then(Value::as_u64) {
        payload.insert("output_compression".to_string(), json!(value.min(100)));
    }
    Value::Object(payload)
}

async fn image_edit_form(
    arguments: &Value,
    prompt: &str,
    image_paths: &[PathBuf],
    model: &str,
) -> anyhow::Result<reqwest::multipart::Form> {
    let mut form = reqwest::multipart::Form::new()
        .text("prompt", prompt.to_string())
        .text("model", model.to_string())
        .text(
            "n",
            arguments
                .get("n")
                .and_then(Value::as_u64)
                .unwrap_or(1)
                .clamp(1, MAX_IMAGE_VARIANTS)
                .to_string(),
        );
    for key in [
        "size",
        "quality",
        "background",
        "output_format",
        "input_fidelity",
    ] {
        if let Some(value) = string_argument(arguments, key) {
            form = form.text(key.to_string(), value.to_string());
        }
    }
    if let Some(value) = arguments.get("output_compression").and_then(Value::as_u64) {
        form = form.text("output_compression", value.min(100).to_string());
    }
    for path in image_paths {
        form = form.part("image[]", multipart_image_part(path).await?);
    }
    if let Some(mask_path) = string_argument(arguments, "mask_path") {
        form = form.part("mask", multipart_image_part(Path::new(mask_path)).await?);
    }
    Ok(form)
}

async fn multipart_image_part(path: &Path) -> anyhow::Result<reqwest::multipart::Part> {
    let bytes = tokio::fs::read(path)
        .await
        .with_context(|| format!("读取输入图片失败：{}", path.display()))?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("image.png")
        .to_string();
    let mime = mime_for_extension(path.extension().and_then(|value| value.to_str()));
    Ok(reqwest::multipart::Part::bytes(bytes)
        .file_name(file_name)
        .mime_str(mime)?)
}

struct ImageOutput {
    bytes: Vec<u8>,
    mime_type: String,
}

async fn extract_image_outputs(
    client: &reqwest::Client,
    payload: &Value,
) -> anyhow::Result<Vec<ImageOutput>> {
    let items = payload
        .get("data")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_else(|| vec![payload.clone()]);
    let mut outputs = Vec::new();
    for item in items {
        if let Some(encoded) = ["b64_json", "image", "b64"]
            .into_iter()
            .find_map(|key| item.get(key).and_then(Value::as_str))
        {
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(encoded.trim())
                .context("图片响应 Base64 无效")?;
            outputs.push(ImageOutput {
                mime_type: detect_image_mime(&bytes).to_string(),
                bytes,
            });
            continue;
        }
        let Some(url) = item.get("url").and_then(Value::as_str) else {
            continue;
        };
        let parsed = reqwest::Url::parse(url).map_err(|_| anyhow::anyhow!("图片响应 URL 无效"))?;
        if !matches!(parsed.scheme(), "http" | "https")
            || !parsed.username().is_empty()
            || parsed.password().is_some()
        {
            anyhow::bail!("图片响应 URL 仅支持无嵌入凭据的 HTTP/HTTPS 地址");
        }
        let response = client
            .get(parsed)
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("下载生成图片失败，未自动重新生成"))?;
        if !response.status().is_success() {
            anyhow::bail!(
                "下载生成图片返回 HTTP {}，未自动重新生成",
                response.status().as_u16()
            );
        }
        let content_type = response
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .filter(|value| value.starts_with("image/"))
            .map(str::to_string);
        let bytes = response
            .bytes()
            .await
            .map_err(|_| anyhow::anyhow!("读取生成图片失败，未自动重新生成"))?
            .to_vec();
        outputs.push(ImageOutput {
            mime_type: content_type.unwrap_or_else(|| detect_image_mime(&bytes).to_string()),
            bytes,
        });
    }
    Ok(outputs)
}

fn helper_url() -> anyhow::Result<String> {
    let raw = std::env::var("ALUNIXA_X_HELPER_URL").unwrap_or_else(|_| {
        format!(
            "http://127.0.0.1:{}",
            crate::protocol_proxy::DEFAULT_PROTOCOL_PROXY_PORT
        )
    });
    let url = reqwest::Url::parse(raw.trim()).context("ALUNIXA_X_HELPER_URL 无效")?;
    let is_loopback = match url.host_str().unwrap_or_default() {
        "localhost" | "::1" => true,
        host => host
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback()),
    };
    if !is_loopback || !matches!(url.scheme(), "http" | "https") {
        anyhow::bail!("ALUNIXA_X_HELPER_URL 必须指向本机 HTTP/HTTPS 地址");
    }
    Ok(raw.trim().trim_end_matches('/').to_string())
}

fn generated_image_output_dir() -> anyhow::Result<PathBuf> {
    let home = crate::codex_home::default_codex_home_dir();
    if home.as_os_str().is_empty() {
        anyhow::bail!("无法解析 CODEX_HOME");
    }
    Ok(home.join("generated_images"))
}

fn unique_output_path(dir: &Path, stamp: u128, index: usize, extension: &str) -> PathBuf {
    let base = dir.join(format!("alunixa-x-{stamp}-{index}.{extension}"));
    if !base.exists() {
        return base;
    }
    for suffix in 2..10_000 {
        let candidate = dir.join(format!("alunixa-x-{stamp}-{index}-{suffix}.{extension}"));
        if !candidate.exists() {
            return candidate;
        }
    }
    dir.join(format!(
        "alunixa-x-{stamp}-{index}-{}.{}",
        std::process::id(),
        extension
    ))
}

fn string_argument<'a>(arguments: &'a Value, key: &str) -> Option<&'a str> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
}

fn detect_image_mime(bytes: &[u8]) -> &'static str {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        "image/webp"
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        "image/gif"
    } else {
        "image/png"
    }
}

fn mime_for_extension(extension: Option<&str>) -> &'static str {
    match extension.unwrap_or_default().to_ascii_lowercase().as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        _ => "image/png",
    }
}

fn extension_for_mime(mime: &str) -> &'static str {
    match mime.split(';').next().unwrap_or(mime).trim() {
        "image/jpeg" => "jpg",
        "image/webp" => "webp",
        "image/gif" => "gif",
        _ => "png",
    }
}

fn json_rpc_error(id: Value, code: i64, message: String) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": { "code": code, "message": message }
    })
}

async fn write_message(stdout: &mut tokio::io::Stdout, message: &Value) -> anyhow::Result<()> {
    let mut encoded = serde_json::to_vec(message)?;
    encoded.push(b'\n');
    stdout.write_all(&encoded).await?;
    stdout.flush().await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_tool_contract_exposes_generation_and_edit_inputs() {
        let tool = image_gen_tool_definition();
        assert_eq!(tool["name"], "image_gen");
        assert_eq!(tool["inputSchema"]["required"], json!(["prompt"]));
        assert!(
            tool["inputSchema"]["properties"]
                .get("image_paths")
                .is_some()
        );
        assert!(tool["inputSchema"]["properties"].get("mask_path").is_some());
        assert!(
            tool["inputSchema"]["properties"]["model"]
                .get("default")
                .is_none()
        );
        assert!(
            tool["inputSchema"]["properties"]
                .get("profile_id")
                .is_some()
        );
    }

    #[test]
    fn image_payload_preserves_supported_options() {
        let payload = image_generation_payload(
            &json!({
                "model": "gpt-image-custom",
                "size": "1024x1536",
                "quality": "high",
                "background": "transparent",
                "output_format": "png",
                "output_compression": 200,
                "n": 9
            }),
            "cat",
            "gpt-image-custom",
        );
        assert_eq!(payload["model"], "gpt-image-custom");
        assert_eq!(payload["background"], "transparent");
        assert_eq!(payload["output_compression"], 100);
        assert_eq!(payload["n"], MAX_IMAGE_VARIANTS);
    }

    #[test]
    fn image_mime_detection_handles_common_formats() {
        assert_eq!(detect_image_mime(b"\x89PNG\r\n\x1a\n"), "image/png");
        assert_eq!(detect_image_mime(&[0xff, 0xd8, 0xff]), "image/jpeg");
        assert_eq!(detect_image_mime(b"RIFFxxxxWEBP"), "image/webp");
    }

    fn image_fixture_server(
        count: usize,
        status: &'static str,
        responder: impl Fn(usize, &str) -> String + Send + 'static,
    ) -> (String, std::thread::JoinHandle<Vec<String>>) {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = format!("http://{}", listener.local_addr().unwrap());
        let address_for_server = address.clone();
        let worker = std::thread::spawn(move || {
            let mut captured = Vec::new();
            for index in 0..count {
                let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
                let mut stream = loop {
                    match listener.accept() {
                        Ok((stream, _)) => break stream,
                        Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                            assert!(
                                std::time::Instant::now() < deadline,
                                "fixture request timed out"
                            );
                            std::thread::sleep(std::time::Duration::from_millis(5));
                        }
                        Err(error) => panic!("fixture accept: {error}"),
                    }
                };
                // The listener is non-blocking only so the accept loop can enforce
                // its deadline; accepted sockets must be blocking for fragmented
                // HTTP request reads on Windows.
                stream.set_nonblocking(false).unwrap();
                stream
                    .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                    .unwrap();
                let mut request = Vec::new();
                let mut buf = [0; 4096];
                loop {
                    let read = stream.read(&mut buf).unwrap();
                    assert!(read > 0);
                    request.extend_from_slice(&buf[..read]);
                    if let Some(end) = request.windows(4).position(|chunk| chunk == b"\r\n\r\n") {
                        let headers = String::from_utf8_lossy(&request[..end]).to_lowercase();
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                line.strip_prefix("content-length:")
                                    .map(|length| length.trim().parse::<usize>().unwrap())
                            })
                            .unwrap_or(0);
                        if request.len() >= end + 4 + length {
                            break;
                        }
                    }
                }
                captured.push(String::from_utf8_lossy(&request).to_string());
                let body = responder(index, &address_for_server);
                write!(stream, "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body).unwrap();
            }
            captured
        });
        (address, worker)
    }

    fn fixture_image_model(id: &str, base_url: &str) -> crate::image_models::ImageModel {
        crate::image_models::ImageModel {
            id: id.into(),
            name: id.into(),
            base_url: base_url.into(),
            api_key: format!("fixture-key-{id}"),
            model: format!("image-{id}"),
        }
    }

    #[tokio::test]
    async fn configured_models_route_generation_and_edits_and_reload_default_without_restart() {
        let (base, worker) = image_fixture_server(2, "200 OK", |_, _| {
            json!({"data":[{"b64_json":"iVBORw0KGgo="}]}).to_string()
        });
        let temp = tempfile::tempdir().unwrap();
        let store = crate::settings::SettingsStore::new(temp.path().join("settings.json"));
        let profiles = vec![
            fixture_image_model("a", &format!("{base}/first/v1")),
            fixture_image_model("b", &format!("{base}/second/v1")),
        ];
        store
            .save(&crate::settings::BackendSettings {
                image_models: profiles.clone(),
                ..Default::default()
            })
            .unwrap();
        let output = temp.path().join("output");
        let result =
            execute_image_gen_with_store(&json!({"prompt":"fixture cat"}), &store, &output)
                .await
                .unwrap();
        assert_eq!(result["structuredContent"]["model"], "image-a");
        let edits = profiles
            .iter()
            .rev()
            .map(|model| crate::image_models::ImageModelEdit {
                id: model.id.clone(),
                name: model.name.clone(),
                base_url: model.base_url.clone(),
                model: model.model.clone(),
                api_key: None,
            })
            .collect();
        store
            .save_image_models(&crate::image_models::snapshot(&profiles).revision, edits)
            .unwrap();
        let input = temp.path().join("fixture.png");
        std::fs::write(&input, b"\x89PNG\r\n\x1a\n").unwrap();
        let result = execute_image_gen_with_store(
            &json!({"prompt":"fixture edit","image_paths":[input],"mask_path":input}),
            &store,
            &output,
        )
        .await
        .unwrap();
        assert_eq!(result["structuredContent"]["model"], "image-b");
        let requests = worker.join().unwrap();
        assert!(requests[0].starts_with("POST /first/v1/images/generations "));
        assert!(
            requests[0]
                .to_lowercase()
                .contains("authorization: bearer fixture-key-a")
        );
        let payload: Value =
            serde_json::from_str(requests[0].split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(payload["model"], "image-a");
        assert!(!payload.to_string().contains("fixture-key"));
        assert!(requests[1].starts_with("POST /second/v1/images/edits "));
        assert!(
            requests[1]
                .to_lowercase()
                .contains("authorization: bearer fixture-key-b")
        );
        assert!(requests[1].contains("name=\"model\"\r\n\r\nimage-b"));
        assert!(requests[1].contains("name=\"image[]\""));
        assert!(requests[1].contains("name=\"mask\""));
        for path in result["structuredContent"]["paths"].as_array().unwrap() {
            assert_eq!(
                std::fs::read(path.as_str().unwrap()).unwrap(),
                b"\x89PNG\r\n\x1a\n"
            );
        }
    }

    #[tokio::test]
    async fn image_downloads_do_not_receive_the_configured_api_key() {
        let (base, worker) = image_fixture_server(2, "200 OK", |index, base| {
            if index == 0 {
                json!({"data":[{"url":format!("{base}/generated.png")}]}).to_string()
            } else {
                "fixture-image-bytes".into()
            }
        });
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap();
        let profile = fixture_image_model("a", &base);
        let target = image_request_target(&json!({}), &[profile]).unwrap();
        let payload = send_image_request(&client, &json!({}), "fixture", &[], &target)
            .await
            .unwrap();
        let images = extract_image_outputs(&client, &payload).await.unwrap();
        assert_eq!(images.len(), 1);
        let requests = worker.join().unwrap();
        assert!(
            requests[0]
                .to_lowercase()
                .contains("authorization: bearer fixture-key-a")
        );
        assert!(requests[1].starts_with("GET /generated.png "));
        assert!(!requests[1].to_lowercase().contains("authorization:"));
        assert!(!requests[1].contains("fixture-key"));
    }

    #[test]
    fn explicit_unknown_configured_model_does_not_fall_back_to_another_provider() {
        let models = vec![fixture_image_model("a", "https://fixture.invalid/v1")];
        assert!(image_request_target(&json!({"model":"unknown"}), &models).is_err());
        let target = image_request_target(&json!({"profile_id":"a"}), &models).unwrap();
        assert_eq!(target.model, "image-a");
    }

    #[tokio::test]
    async fn configured_image_requests_never_follow_redirects_retry_or_echo_upstream_secrets() {
        for status in [
            "500 Internal Server Error",
            "307 Temporary Redirect\r\nLocation: http://127.0.0.1:9/do-not-follow",
        ] {
            let (base, worker) = image_fixture_server(1, status, |_, _| {
                json!({"error":"fixture-key-a reflected secret and prompt"}).to_string()
            });
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap();
            let target =
                image_request_target(&json!({}), &[fixture_image_model("a", &base)]).unwrap();
            let error = send_image_request(&client, &json!({}), "fixture", &[], &target)
                .await
                .unwrap_err()
                .to_string();
            assert!(error.contains(&format!("HTTP {}", &status[..3])));
            assert!(!error.contains("fixture-key"));
            assert!(!error.contains("reflected"));
            assert_eq!(worker.join().unwrap().len(), 1);
        }
    }

    #[tokio::test]
    async fn failed_image_downloads_do_not_echo_signed_urls_or_save_redirect_bodies() {
        for status in [
            "500 Internal Server Error",
            "307 Temporary Redirect\r\nLocation: http://127.0.0.1:9/do-not-follow",
        ] {
            let (base, worker) = image_fixture_server(1, status, |_, _| "not an image".into());
            let client = reqwest::Client::builder()
                .no_proxy()
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap();
            let payload = json!({"data":[{"url":format!("{base}/image?token=fixture-secret")}]});
            let error = extract_image_outputs(&client, &payload)
                .await
                .err()
                .unwrap();
            let message = format!("{error:#}");
            assert!(message.contains(&format!("HTTP {}", &status[..3])));
            assert!(!message.contains("fixture-secret"));
            assert!(!message.contains(&base));
            assert_eq!(worker.join().unwrap().len(), 1);
        }
    }
}
