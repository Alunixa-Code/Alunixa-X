use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    codex_plus_core::imagegen_mcp::run_imagegen_mcp_from_stdio().await
}
