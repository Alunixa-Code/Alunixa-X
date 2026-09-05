use anyhow::Result;

#[tokio::main]
async fn main() -> Result<()> {
    if std::env::args()
        .skip(1)
        .any(|arg| arg == "--context-management")
    {
        alunixa_x_core::context_mcp::run_context_mcp_from_stdio().await
    } else {
        alunixa_x_core::imagegen_mcp::run_imagegen_mcp_from_stdio().await
    }
}
