use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    alunixa_x_core::imagegen_mcp::run_imagegen_mcp_from_stdio().await
}
