//! The AI chat plugin's answers: the shared language model (models::llm) gets
//! the sources the app found (src/plugins/chat) and the conversation, and
//! streams its answer back over a channel. Finding happens in the app.

use crate::models::llm;
use serde::Deserialize;
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::{ipc::Channel, AppHandle};

/// Requests with an id up to this one are stopped (like writing_cancel).
static CANCELLED: AtomicU64 = AtomicU64::new(0);

#[derive(Deserialize)]
pub struct ChatTurn {
    /// "user" or "model"
    role: String,
    text: String,
}

#[derive(Deserialize)]
pub struct ChatRequest {
    id: u64,
    system: String,
    /// Earlier turns, then the question (with its sources) last.
    turns: Vec<ChatTurn>,
}

/// Gemma 4's format for a conversation (see llm::chat), ending where the model answers.
pub(crate) fn prompt(r: &ChatRequest) -> String {
    let mut p = format!("<|turn>system\n{}<turn|>\n", r.system);
    for t in &r.turns {
        let role = if t.role == "model" { "model" } else { "user" };
        p += &format!("<|turn>{role}\n{}<turn|>\n", t.text);
    }
    p + "<|turn>model\n"
}

#[tauri::command]
pub async fn chat_run(app: AppHandle, request: ChatRequest, on_piece: Channel<String>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let model = llm::load(&app)?;
        let id = request.id;
        let g = llm::Generation { max_output: 900, temperature: 0.2, seed: 1 };
        llm::generate(&model, &prompt(&request), &g, &mut |piece| CANCELLED.load(Ordering::SeqCst) < id && on_piece.send(piece.to_string()).is_ok())?;
        Ok(())
    })
    .await
    .map_err(|e| format!("The chat crashed: {e}"))?
}

#[tauri::command]
pub fn chat_cancel(id: u64) {
    CANCELLED.fetch_max(id, Ordering::SeqCst);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversation_in_gemmas_format() {
        let r = ChatRequest {
            id: 1,
            system: "Be brief.".into(),
            turns: vec![
                ChatTurn { role: "user".into(), text: "Hi".into() },
                ChatTurn { role: "model".into(), text: "Hello!".into() },
                ChatTurn { role: "user".into(), text: "And now?".into() },
            ],
        };
        assert_eq!(
            prompt(&r),
            "<|turn>system\nBe brief.<turn|>\n<|turn>user\nHi<turn|>\n<|turn>model\nHello!<turn|>\n<|turn>user\nAnd now?<turn|>\n<|turn>model\n"
        );
    }
}
