use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    anyhow::ensure!(
        std::env::args_os().nth(1).is_none(),
        "Unsupported imagegen companion arguments"
    );
    alunixa_x_core::imagegen_mcp::run_imagegen_mcp_from_stdio().await
}
