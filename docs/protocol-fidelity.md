# 本地协议转换保真规则

## 范围

- 转换由本机 Helper 的 `protocol_proxy` 执行，之后访问用户配置的上游；原生 Responses 与透明 HTTP/WebSocket 不强制绕经 Chat Completions 喵~
- 本次修改不安装或重启 Codex，不改用户真实 config/auth，也不使用真实账户发送测试对话喵~
- 核心约束是“不静默丢失、不把一种消息类型伪装成另一种、不把失败伪装为完成”，而不是宣称互不兼容的协议具备相同能力喵~

## 输入及历史

| 情况 | 处理 |
| --- | --- |
| function/custom/namespace 工具 | 保留调用关联和参数，检测名称展开冲突 |
| 孤立/重复工具输出、缺失身份、非法 JSON 参数 | 转换失败，不改写成 user 或 `{input: ...}` |
| 未识别输入内容、未解析 item_reference、服务端 previous_response_id | 明确失败，不清空历史 |
| 有效图片 URL/detail、Chat 文件/音频输入 | 使用对应内容类型，不退化为正文 |
| 无法表达的原生图片 detail、多模态工具结果 | 明确失败，Anthropic 图片工具结果有独立映射 |
| json_schema 输出 | 映射 Chat response_format / Gemini responseJsonSchema |
| 消息 phase/channel 等不可等价的控制字段 | 要求原生 Responses，不静默抹掉 |
| 旧 Completions + 工具/思考/非文本内容 | 明确失败，旧文本协议不能充当工具调用协议 |
| image_generation/web_search/file_search/computer 等服务端工具 | 不伪造为本地函数；使用原生支持的上游 |
| 不支持的顶层字段/原生思考参数 | 明确错误，不猜测语义 |

## 思考与原生回放

- Anthropic 原始内容块及 Gemini 原始 parts 通过 Responses reasoning 项的 opaque `encrypted_content` 字段携带，包含签名、redacted 内容、顺序及原始函数身份喵~
- `alunixa-x-replay-v1:` 是版本化 Base64 JSON 传输标记，**不是额外加密**；该字段不作为正文渲染，也不写入诊断日志喵~
- 回放项包含其覆盖的输出项，续轮先核对相邻历史再恢复原生内容；历史缺失、被编辑或协议不一致时不拼接、不重放、不借用其他会话缓存喵~
- Gemini call_id 和缺失的 response_id 使用请求间唯一标识，不再使用 `call_gemini_0` 等共享键，也不在缓存满时清空所有签名喵~
- 原生思考在不具备签名/原始回放依据时不会降为普通 assistant 文本；Chat 的非流式 reasoning_details 可保持原样回放，尚不能可靠重建的 opaque reasoning_details 流明确失败喵~
- API 请求中的模型、供应商和签名能力仍由上游校验，不能把另一协议的签名转成有效的本供应商签名喵~

## 流式不变量

- 严格 UTF-8 解码；支持字节分片、BOM、LF/CRLF/CR 及无空行的最后一帧，非法字节和损坏 JSON 不使用替换字符掩盖喵~
- Chat finish_reason 后继续读取 usage 和终止帧，Anthropic message_delta 后等待 message_stop；EOF 没有完成依据则失败喵~
- HTTP 层在上游已声明停止生成后最多继续等终止帧 5 秒，该截止时间不因心跳重置，超时失败而非卡在思考或重放请求喵~
- completed / incomplete / failed 为互斥终态，事件 sequence_number 单调递增；终态后忽略重复输入，不再次发出完成或失败喵~
- 思考、正文、refusal 分别使用匹配的类型/事件，交错输出使用独立的 item_id 和 output_index 喵~
- `<think>` 仅在正文开头识别，思考增量立即输出，只暂存可能跨分片的结束标签；不使用泛化“删除调试文本”正则破坏用户正文喵~
- 工具名/ID 未完整前不发布工具身份；参数保持原字符串，完整 JSON、稳定身份和唯一 call_id 校验通过后才发可执行的 done 事件喵~
- 达到 token 限制时发 response.incomplete，不把截断工具调用标为 completed 喵~
- 上游对 stream 请求返回 JSON 时，由完整响应生成相同下游 SSE 契约，包括文本/思考/工具及原生回放项喵~

## 错误与重试

- 不支持的请求在 HTTP 层返回 400 和 `unsupported_protocol_conversion`，上游 JSON/协议错误返回结构化 502，流错误为 response.failed，不插入 assistant 正文喵~
- 仅连接建立失败可进行原有一次连接重试，聚合成员只对明确的 401/403/429 拒绝切换；POST 已到达上游后的断连、头部超时、500/503 等结果不明场景不自动重放喵~
- Responses ID 协商仍受用户原有开关控制，已经出现输出事件之后即使后续错误文本像 ID 校验失败，也不再次发送请求喵~
- 原生协议不支持的功能不会因返回错误变成“已支持”；应选择支持该能力的原生供应商，而不是静默删除工具或内容喵~

## 验证与回滚

- 2026-09-14 最终本地验收：Rust 工作区 39 套件，1090 passed / 0 failed / 1 ignored；保真 31/31 + 既有协议 71/71，前端 98/98，类型/编译/格式/品牌/国际化检查全部通过喵~
- 最终验证严格串行执行，避免 Windows 正在运行的测试 exe 与下一轮链接冲突；前序失败的构建不计入成功结果，未在真实模型账户或运行窗口中验证喵~

```powershell
cargo test -p alunixa-x-core --test protocol_fidelity --test protocol_proxy --locked --no-fail-fast -- --test-threads=1
cargo test --workspace --locked --no-fail-fast -j 2 -- --test-threads=1
cargo check --workspace --all-targets --locked
cargo fmt --all -- --check
npm --prefix apps/alunixa-x-manager test
npm --prefix apps/alunixa-x-manager run check
git diff --check
```

- 新增测试先在旧实现复现 13 项失败，再覆盖签名回放、逐字节流、损坏帧、工具重复身份、HTTP 断连/500 不重放和 JSON-to-SSE 契约等边界喵~
- 自动化验证使用本机随机端口及内存 fixture，不能代替所有真实模型和供应商的逐一实测喵~
- 修改前检查点 `a9a50ac`，本次协议修复的上一稳定发行基线为 v1.0.17；需要回滚时针对本次提交执行 revert，不 reset --hard 或覆盖其他人的修改喵~
