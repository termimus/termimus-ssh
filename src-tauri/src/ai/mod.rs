pub mod client;
pub mod command;
pub mod environment;
pub mod prompt;
pub mod sanitizer;

pub use client::{AiClient, AiStreamChunk, ChatMessage, AI_CANCELLED};
pub use command::{parse_command_response, AiCommandResult};
pub use environment::{detect_local_environment, parse_probe_output, TerminalEnvironment, PROBE_SCRIPT};
pub use prompt::{build_command_system_prompt, build_explain_system_prompt, PromptTarget};
pub use sanitizer::sanitize_terminal_buffer;
