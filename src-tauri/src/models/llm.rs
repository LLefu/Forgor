//! The language model (Gemma 4 E4B via llama.cpp), shared by everything that
//! generates text: meeting summaries, the writing tools and, later, plugins.
//! One copy is loaded at a time and stays loaded a while after its last use.

use super::{model_path, threads, LANGUAGE};
pub use llama_cpp_2::model::LlamaModel;
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos},
    sampling::LlamaSampler,
};
use std::{
    num::NonZeroU32,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
    time::{Duration, Instant},
};
use tauri::AppHandle;

pub(crate) fn backend() -> Result<&'static LlamaBackend, String> {
    // llama.cpp may only be initialised once per process.
    static BACKEND: OnceLock<Result<LlamaBackend, String>> = OnceLock::new();
    BACKEND
        .get_or_init(|| {
            let mut b = LlamaBackend::init().map_err(|e| e.to_string())?;
            b.void_logs();
            Ok(b)
        })
        .as_ref()
        .map_err(Clone::clone)
}

/// Gemma 4's chat format (llama.cpp's built-in template list doesn't know it).
/// Changing the language model means changing this too.
pub fn chat(system: &str, user: &str) -> String {
    format!("<|turn>system\n{system}<turn|>\n<|turn>user\n{user}<turn|>\n<|turn>model\n")
}

/// The language model stays loaded this long after its last use, so the next
/// summary or writing request doesn't wait for 4.6 GB to load again.
const KEEP_LOADED: Duration = Duration::from_secs(5 * 60);

struct Loaded {
    path: PathBuf,
    model: Arc<LlamaModel>,
    last_used: Instant,
}

static LOADED: Mutex<Option<Loaded>> = Mutex::new(None);

/// The downloaded language model, loaded once and shared.
pub fn load(app: &AppHandle) -> Result<Arc<LlamaModel>, String> {
    shared(&model_path(app, LANGUAGE)?)
}

/// The model at `path`, loaded once and shared (tests pass their own file).
pub fn shared(path: &Path) -> Result<Arc<LlamaModel>, String> {
    let backend = backend()?;
    let mut loaded = LOADED.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(l) = loaded.as_mut().filter(|l| l.path == path) {
        l.last_used = Instant::now();
        return Ok(l.model.clone());
    }
    *loaded = None; // another file: free the old one first
    // All layers on the GPU where there is one (Metal on macOS); CPU otherwise.
    let model = Arc::new(
        LlamaModel::load_from_file(backend, path, &LlamaModelParams::default().with_n_gpu_layers(999))
            .map_err(|e| format!("Could not load the language model: {e}"))?,
    );
    *loaded = Some(Loaded { path: path.to_path_buf(), model: model.clone(), last_used: Instant::now() });
    drop(loaded);
    static WATCHER: OnceLock<()> = OnceLock::new();
    WATCHER.get_or_init(|| {
        std::thread::spawn(|| loop {
            std::thread::sleep(Duration::from_secs(30));
            let mut loaded = LOADED.lock().unwrap_or_else(|e| e.into_inner());
            // Still in use (a request holds a clone): keep it.
            if loaded.as_ref().is_some_and(|l| l.last_used.elapsed() > KEEP_LOADED && Arc::strong_count(&l.model) == 1) {
                *loaded = None;
            }
        });
    });
    Ok(model)
}

/// Marks the shared model as used now (at the end of a long request).
fn touch() {
    if let Some(l) = LOADED.lock().unwrap_or_else(|e| e.into_inner()).as_mut() {
        l.last_used = Instant::now();
    }
}

/// Frees the shared model: before its file is deleted (Windows can't delete a
/// mapped file) and before exit (llama.cpp's Metal code aborts otherwise).
pub fn unload() {
    *LOADED.lock().unwrap_or_else(|e| e.into_inner()) = None;
}

/// How many tokens `text` is for the model.
pub fn count_tokens(model: &LlamaModel, text: &str) -> Result<usize, String> {
    Ok(model.str_to_token(text, AddBos::Never).map_err(|e| e.to_string())?.len())
}

pub struct Generation {
    pub max_output: usize,
    pub temperature: f32,
    pub seed: u32,
}

/// Runs the model on `prompt` (see `chat`). `on_piece` gets the text as it is
/// generated and returns false to stop early.
pub fn generate(model: &LlamaModel, prompt: &str, g: &Generation, on_piece: &mut dyn FnMut(&str) -> bool) -> Result<String, String> {
    let backend = backend()?;
    let tokens = model.str_to_token(prompt, AddBos::Always).map_err(|e| e.to_string())?;
    let n_ctx = (tokens.len() + g.max_output + 64) as u32;
    let batch_size = 2048;
    let params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(n_ctx))
        .with_n_batch(batch_size as u32)
        .with_n_threads(threads())
        .with_n_threads_batch(threads());
    let mut ctx = model.new_context(backend, params).map_err(|e| format!("Not enough memory for the language model: {e}"))?;

    let mut batch = LlamaBatch::new(batch_size, 1);
    let mut pos = 0i32;
    for chunk in tokens.chunks(batch_size) {
        batch.clear();
        for (i, t) in chunk.iter().enumerate() {
            let last = pos as usize + i == tokens.len() - 1;
            batch.add(*t, pos + i as i32, &[0], last).map_err(|e| e.to_string())?;
        }
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;
        pos += chunk.len() as i32;
    }

    let mut sampler = LlamaSampler::chain_simple([LlamaSampler::temp(g.temperature), LlamaSampler::top_p(0.9, 1), LlamaSampler::dist(g.seed)]);
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut out = String::new();
    for _ in 0..g.max_output {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);
        if model.is_eog_token(token) {
            break;
        }
        let piece = model.token_to_piece(token, &mut decoder, false, None).map_err(|e| e.to_string())?;
        out += &piece;
        if !on_piece(&piece) {
            break;
        }
        batch.clear();
        batch.add(token, pos, &[0], true).map_err(|e| e.to_string())?;
        pos += 1;
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;
    }
    touch();
    Ok(out)
}
