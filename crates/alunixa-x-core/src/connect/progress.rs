use std::collections::HashMap;
use std::time::Duration;

use tokio::sync::mpsc::UnboundedReceiver;

use super::app_server::{AppServerProgressEvent, AppServerProgressKind, AppServerProgressPhase};
use super::weixin::WeixinClient;

const FLUSH_INTERVAL: Duration = Duration::from_millis(1_200);
const DELTA_FLUSH_CHARS: usize = 1_600;
const MAX_PROGRESS_CHARS_PER_TURN: usize = 128_000;

#[derive(Debug, Clone)]
struct PendingDelta {
    kind: AppServerProgressKind,
    title: String,
    text: String,
}

#[derive(Debug, Default)]
pub(crate) struct ProgressMessageBatcher {
    pending: HashMap<String, PendingDelta>,
    forwarded_chars: usize,
    truncation_notice_sent: bool,
}

impl ProgressMessageBatcher {
    pub(crate) fn push(&mut self, event: AppServerProgressEvent) -> Vec<String> {
        if event.phase == AppServerProgressPhase::Delta {
            return self.push_delta(event);
        }
        let mut messages = self.flush_item(&event.item_id);
        if let Some(message) = format_event(&event) {
            messages.push(message);
        }
        messages
    }

    pub(crate) fn flush_due(&mut self) -> Vec<String> {
        let keys = self.pending.keys().cloned().collect::<Vec<_>>();
        keys.into_iter()
            .flat_map(|key| self.flush_item(&key))
            .collect()
    }

    fn push_delta(&mut self, event: AppServerProgressEvent) -> Vec<String> {
        if event.detail.is_empty() {
            return Vec::new();
        }
        if self.forwarded_chars >= MAX_PROGRESS_CHARS_PER_TURN {
            if self.truncation_notice_sent {
                return Vec::new();
            }
            self.truncation_notice_sent = true;
            return vec![
                "⚠️ 实时输出过多\n本轮增量输出已达到 128K 字符保护上限，后续仍会发送每项操作的完成、失败状态和最终回复。"
                    .to_string(),
            ];
        }
        let remaining = MAX_PROGRESS_CHARS_PER_TURN.saturating_sub(self.forwarded_chars);
        let detail = event.detail.chars().take(remaining).collect::<String>();
        self.forwarded_chars = self.forwarded_chars.saturating_add(detail.chars().count());
        let pending = self
            .pending
            .entry(event.item_id.clone())
            .or_insert_with(|| PendingDelta {
                kind: event.kind,
                title: event.title.clone(),
                text: String::new(),
            });
        pending.kind = event.kind;
        pending.title = event.title;
        if !pending.text.is_empty() && needs_separator(&pending.text, &detail) {
            pending.text.push('\n');
        }
        pending.text.push_str(&detail);
        if pending.text.chars().count() >= DELTA_FLUSH_CHARS {
            self.flush_item(&event.item_id)
        } else {
            Vec::new()
        }
    }

    fn flush_item(&mut self, item_id: &str) -> Vec<String> {
        let Some(pending) = self.pending.remove(item_id) else {
            return Vec::new();
        };
        let text = pending.text.trim();
        if text.is_empty() {
            return Vec::new();
        }
        vec![format!(
            "{} {}\n{}",
            kind_icon(pending.kind),
            pending.title,
            text
        )]
    }
}

pub(crate) async fn forward_progress_to_weixin(
    client: WeixinClient,
    to_user_id: String,
    context_token: String,
    mut receiver: UnboundedReceiver<AppServerProgressEvent>,
) -> anyhow::Result<()> {
    let mut batcher = ProgressMessageBatcher::default();
    let mut interval = tokio::time::interval(FLUSH_INTERVAL);
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    interval.tick().await;
    loop {
        let messages = tokio::select! {
            event = receiver.recv() => {
                match event {
                    Some(event) => batcher.push(event),
                    None => {
                        send_messages(&client, &to_user_id, &context_token, batcher.flush_due()).await?;
                        return Ok(());
                    }
                }
            }
            _ = interval.tick() => batcher.flush_due(),
        };
        send_messages(&client, &to_user_id, &context_token, messages).await?;
    }
}

async fn send_messages(
    client: &WeixinClient,
    to_user_id: &str,
    context_token: &str,
    messages: Vec<String>,
) -> anyhow::Result<()> {
    for message in messages {
        client
            .send_text_chunks(to_user_id, &message, context_token)
            .await?;
    }
    Ok(())
}

fn format_event(event: &AppServerProgressEvent) -> Option<String> {
    if event.kind == AppServerProgressKind::Reply
        && event.phase == AppServerProgressPhase::Completed
    {
        return Some("✅ 最终回复已生成\n正在发送完整回复。".to_string());
    }
    if event.phase == AppServerProgressPhase::Delta {
        return None;
    }
    let detail = event.detail.trim();
    let header = format!("{} {}", phase_icon(event.phase), event.title);
    if detail.is_empty() {
        Some(header)
    } else {
        Some(format!("{header}\n{detail}"))
    }
}

fn kind_icon(kind: AppServerProgressKind) -> &'static str {
    match kind {
        AppServerProgressKind::Status => "🚀",
        AppServerProgressKind::Reasoning => "🧠",
        AppServerProgressKind::Plan => "📋",
        AppServerProgressKind::WebSearch => "🌐",
        AppServerProgressKind::Command => "💻",
        AppServerProgressKind::FileChange => "📝",
        AppServerProgressKind::Tool => "🧰",
        AppServerProgressKind::Collaboration => "🤝",
        AppServerProgressKind::Image => "🖼️",
        AppServerProgressKind::Review => "🔎",
        AppServerProgressKind::Compaction => "🗜️",
        AppServerProgressKind::Reply => "✍️",
        AppServerProgressKind::Error => "❌",
        AppServerProgressKind::Other => "⚙️",
    }
}

fn phase_icon(phase: AppServerProgressPhase) -> &'static str {
    match phase {
        AppServerProgressPhase::Started => "▶️",
        AppServerProgressPhase::Delta => "🔄",
        AppServerProgressPhase::Completed => "✅",
        AppServerProgressPhase::Failed => "❌",
    }
}

fn needs_separator(existing: &str, incoming: &str) -> bool {
    !existing.ends_with(['\n', ' ', '\t']) && !incoming.starts_with(['\n', ' ', '\t'])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event(
        item_id: &str,
        kind: AppServerProgressKind,
        phase: AppServerProgressPhase,
        title: &str,
        detail: &str,
    ) -> AppServerProgressEvent {
        AppServerProgressEvent {
            item_id: item_id.to_string(),
            kind,
            phase,
            title: title.to_string(),
            detail: detail.to_string(),
        }
    }

    #[test]
    fn batches_reasoning_and_command_output_before_completion() {
        let mut batcher = ProgressMessageBatcher::default();
        assert!(
            batcher
                .push(event(
                    "reason-1",
                    AppServerProgressKind::Reasoning,
                    AppServerProgressPhase::Delta,
                    "思考摘要",
                    "先检查配置"
                ))
                .is_empty()
        );
        let flushed = batcher.flush_due();
        assert_eq!(flushed, vec!["🧠 思考摘要\n先检查配置"]);

        assert!(
            batcher
                .push(event(
                    "cmd-1",
                    AppServerProgressKind::Command,
                    AppServerProgressPhase::Delta,
                    "命令输出",
                    "line one"
                ))
                .is_empty()
        );
        let completed = batcher.push(event(
            "cmd-1",
            AppServerProgressKind::Command,
            AppServerProgressPhase::Completed,
            "命令执行完成",
            "退出码：0",
        ));
        assert_eq!(
            completed,
            vec!["💻 命令输出\nline one", "✅ 命令执行完成\n退出码：0"]
        );
    }

    #[test]
    fn keeps_operation_status_after_delta_limit() {
        let mut batcher = ProgressMessageBatcher {
            forwarded_chars: MAX_PROGRESS_CHARS_PER_TURN,
            ..ProgressMessageBatcher::default()
        };
        let first = batcher.push(event(
            "cmd",
            AppServerProgressKind::Command,
            AppServerProgressPhase::Delta,
            "命令输出",
            "extra",
        ));
        assert_eq!(first.len(), 1);
        assert!(first[0].contains("128K"));
        let completed = batcher.push(event(
            "cmd",
            AppServerProgressKind::Command,
            AppServerProgressPhase::Completed,
            "命令执行完成",
            "退出码：0",
        ));
        assert_eq!(completed, vec!["✅ 命令执行完成\n退出码：0"]);
    }
}
