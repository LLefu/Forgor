//! The search model (EmbeddingGemma 300M via llama.cpp): turns text into a
//! vector that says what it's about, so the AI chat finds notes on the same
//! subject in other words or another language ("cloud" → "hosting goes to AWS").
//! Loaded once and kept, like the language model; it's small (334 MB).

use super::{llm, model_path, threads, SEARCH};
use llama_cpp_2::{
    context::params::{LlamaContextParams, LlamaPoolingType},
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
};
use std::{
    num::NonZeroU32,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::AppHandle;

static LOADED: Mutex<Option<(PathBuf, Arc<LlamaModel>)>> = Mutex::new(None);

/// Longest text embedded, in tokens (the rest is cut off; sections are short).
const MAX_TOKENS: usize = 1024;

fn shared(path: &Path) -> Result<Arc<LlamaModel>, String> {
    let backend = llm::backend()?;
    let mut loaded = LOADED.lock().unwrap_or_else(|e| e.into_inner());
    if let Some((p, m)) = loaded.as_ref() {
        if p == path {
            return Ok(m.clone());
        }
    }
    let model = Arc::new(
        LlamaModel::load_from_file(backend, path, &LlamaModelParams::default().with_n_gpu_layers(999))
            .map_err(|e| format!("Could not load the search model: {e}"))?,
    );
    *loaded = Some((path.to_path_buf(), model.clone()));
    Ok(model)
}

/// Frees the search model (before deleting its file, and before exit: see llm::unload).
pub fn unload() {
    *LOADED.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// One normalised vector per text (mean-pooled), so a dot product is the cosine similarity.
pub fn embed_with(model: &LlamaModel, texts: &[String]) -> Result<Vec<Vec<f32>>, String> {
    let params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(MAX_TOKENS as u32 + 8))
        .with_n_batch(MAX_TOKENS as u32 + 8)
        .with_n_ubatch(MAX_TOKENS as u32 + 8)
        .with_embeddings(true)
        .with_pooling_type(LlamaPoolingType::Mean)
        .with_n_threads(threads())
        .with_n_threads_batch(threads());
    let mut ctx = model.new_context(llm::backend()?, params).map_err(|e| format!("Not enough memory for the search model: {e}"))?;
    let mut out = Vec::with_capacity(texts.len());
    for text in texts {
        let mut tokens = model.str_to_token(text, AddBos::Always).map_err(|e| e.to_string())?;
        tokens.truncate(MAX_TOKENS);
        ctx.clear_kv_cache();
        let mut batch = LlamaBatch::new(MAX_TOKENS + 8, 1);
        for (i, t) in tokens.iter().enumerate() {
            batch.add(*t, i as i32, &[0], true).map_err(|e| e.to_string())?;
        }
        if ctx.encode(&mut batch).is_err() {
            ctx.decode(&mut batch).map_err(|e| e.to_string())?;
        }
        let v = ctx.embeddings_seq_ith(0).map_err(|e| e.to_string())?;
        let len = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-6);
        out.push(v.iter().map(|x| x / len).collect());
    }
    Ok(out)
}

/// Vectors for `texts` (the AI chat's index and questions). Needs the search model.
#[tauri::command]
pub async fn search_embed(app: AppHandle, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let model = shared(&model_path(&app, SEARCH)?)?;
        embed_with(&model, &texts)
    })
    .await
    .map_err(|e| format!("Search crashed: {e}"))?
}
