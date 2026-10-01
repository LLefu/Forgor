//! The two downloadable models for meeting recordings: speech recognition
//! (Parakeet v3 + Silero VAD, via sherpa-onnx) and summaries (Gemma 4 E4B, via
//! llama.cpp). They live in the app data folder, never in the notes folder.

use futures_util::StreamExt;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::AsyncWriteExt;

pub struct ModelFile {
    pub name: &'static str,
    pub url: &'static str,
    pub size: u64,
    /// SHA-256 of the file; every download is verified against it.
    pub sha256: &'static str,
}

pub struct Model {
    pub id: &'static str,
    pub files: &'static [ModelFile],
}

// Pinned revisions, so an upstream change can't break (or swap) a model.
macro_rules! parakeet {
    ($file:literal) => {
        concat!("https://huggingface.co/csukuangfj/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8/resolve/2bda32ec70b097a55adaa07d9a7173915b43cc78/", $file)
    };
}
macro_rules! gemma {
    ($file:literal) => {
        concat!("https://huggingface.co/ggml-org/gemma-4-E4B-it-GGUF/resolve/b8093469224f83f5c38f691eb906c380e9e63114/", $file)
    };
}

pub const MODELS: &[Model] = &[
    Model {
        id: "speech",
        files: &[
            ModelFile { name: "encoder.int8.onnx", url: parakeet!("encoder.int8.onnx"), size: 652_184_281, sha256: "acfc2b4456377e15d04f0243af540b7fe7c992f8d898d751cf134c3a55fd2247" },
            ModelFile { name: "decoder.int8.onnx", url: parakeet!("decoder.int8.onnx"), size: 11_845_275, sha256: "179e50c43d1a9de79c8a24149a2f9bac6eb5981823f2a2ed88d655b24248db4e" },
            ModelFile { name: "joiner.int8.onnx", url: parakeet!("joiner.int8.onnx"), size: 6_355_277, sha256: "3164c13fc2821009440d20fcb5fdc78bff28b4db2f8d0f0b329101719c0948b3" },
            ModelFile { name: "tokens.txt", url: parakeet!("tokens.txt"), size: 93_939, sha256: "d58544679ea4bc6ac563d1f545eb7d474bd6cfa467f0a6e2c1dc1c7d37e3c35d" },
            ModelFile {
                name: "silero_vad.onnx",
                url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx",
                size: 643_854,
                sha256: "9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6",
            },
        ],
    },
    Model {
        // Optional: tells the other participants apart ("Spreker 1, 2…").
        id: "speakers",
        files: &[
            ModelFile {
                name: "segmentation.onnx",
                url: "https://huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0/resolve/9403a6902bb58e3d5ae8c7e77c3422de279db2e0/model.onnx",
                size: 5_992_913,
                sha256: "220ad67ca923bef2fa91f2390c786097bf305bceb5e261d4af67b38e938e1079",
            },
            ModelFile {
                name: "embedding.onnx",
                url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx",
                size: 28_281_164,
                sha256: "aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2",
            },
        ],
    },
    Model {
        id: "summary",
        files: &[ModelFile {
            name: "gemma-4-E4B-it-Q4_0.gguf",
            url: gemma!("gemma-4-E4B-it-Q4_0.gguf"),
            size: 4_590_807_392,
            sha256: "a555b900214b477d8880e7832e0b8925e139b0159640036b09fe472b6f2097f2",
        }],
    },
];

pub fn find(id: &str) -> Result<&'static Model, String> {
    MODELS.iter().find(|m| m.id == id).ok_or_else(|| format!("Unknown model \"{id}\""))
}

pub fn models_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("models"))
}

pub fn model_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    Ok(models_root(app)?.join(id))
}

/// A model counts as downloaded when every file is there with the expected size
/// (the hash is checked once, right after downloading).
pub fn is_downloaded(dir: &Path, model: &Model) -> bool {
    model.files.iter().all(|f| std::fs::metadata(dir.join(f.name)).map(|m| m.len() == f.size).unwrap_or(false))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelStatus {
    id: &'static str,
    size_bytes: u64,
    downloaded: bool,
    downloading: bool,
    path: String,
}

#[derive(Default)]
pub struct Downloads {
    active: Mutex<HashSet<String>>,
    cancelled: Mutex<HashSet<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    id: String,
    received: u64,
    total: u64,
    done: bool,
    error: Option<String>,
}

#[tauri::command]
pub fn meetings_models(app: AppHandle, downloads: tauri::State<'_, Downloads>) -> Result<Vec<ModelStatus>, String> {
    let active = downloads.active.lock().unwrap().clone();
    MODELS
        .iter()
        .map(|m| {
            let dir = model_dir(&app, m.id)?;
            Ok(ModelStatus {
                id: m.id,
                size_bytes: m.files.iter().map(|f| f.size).sum(),
                downloaded: is_downloaded(&dir, m),
                downloading: active.contains(m.id),
                path: dir.to_string_lossy().into_owned(),
            })
        })
        .collect()
}

/// Download a model's files, emitting `wn://model-download` progress events.
/// Files go to `<name>.part` first and are only renamed after the hash matches.
#[tauri::command]
pub async fn meetings_download(app: AppHandle, id: String) -> Result<(), String> {
    let model = find(&id)?;
    let downloads = app.state::<Downloads>();
    if !downloads.active.lock().unwrap().insert(id.clone()) {
        return Ok(()); // already running
    }
    downloads.cancelled.lock().unwrap().remove(&id);
    let result = download(&app, model).await;
    app.state::<Downloads>().active.lock().unwrap().remove(&id);
    let total = model.files.iter().map(|f| f.size).sum();
    let _ = app.emit(
        "wn://model-download",
        Progress { id: id.clone(), received: if result.is_ok() { total } else { 0 }, total, done: true, error: result.as_ref().err().cloned() },
    );
    result
}

async fn download(app: &AppHandle, model: &'static Model) -> Result<(), String> {
    let dir = model_dir(app, model.id)?;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;
    let total: u64 = model.files.iter().map(|f| f.size).sum();
    let mut received: u64 = 0;
    let client = reqwest::Client::builder().user_agent("Forgor").build().map_err(|e| e.to_string())?;
    let mut last_emit = std::time::Instant::now();

    for file in model.files {
        let target = dir.join(file.name);
        if std::fs::metadata(&target).map(|m| m.len() == file.size).unwrap_or(false) {
            received += file.size;
            continue;
        }
        let part = dir.join(format!("{}.part", file.name));
        let response = client.get(file.url).send().await.map_err(|e| format!("Download failed: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("Download failed ({}) for {}", response.status(), file.name));
        }
        let mut out = tokio::fs::File::create(&part).await.map_err(|e| e.to_string())?;
        let mut hasher = Sha256::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            if app.state::<Downloads>().cancelled.lock().unwrap().contains(model.id) {
                drop(out);
                let _ = tokio::fs::remove_file(&part).await;
                return Err("Download cancelled".into());
            }
            let chunk = chunk.map_err(|e| format!("Download interrupted: {e}"))?;
            hasher.update(&chunk);
            out.write_all(&chunk).await.map_err(|e| format!("Could not save the model (disk full?): {e}"))?;
            received += chunk.len() as u64;
            if last_emit.elapsed().as_millis() > 250 {
                last_emit = std::time::Instant::now();
                let _ = app.emit("wn://model-download", Progress { id: model.id.into(), received, total, done: false, error: None });
            }
        }
        out.flush().await.map_err(|e| e.to_string())?;
        drop(out);
        let hash = format!("{:x}", hasher.finalize());
        if hash != file.sha256 {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(format!("{} is damaged (checksum mismatch); please try again", file.name));
        }
        tokio::fs::rename(&part, &target).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn meetings_cancel_download(downloads: tauri::State<'_, Downloads>, id: String) {
    downloads.cancelled.lock().unwrap().insert(id);
}

#[tauri::command]
pub fn meetings_delete_model(app: AppHandle, downloads: tauri::State<'_, Downloads>, id: String) -> Result<(), String> {
    find(&id)?;
    if downloads.active.lock().unwrap().contains(&id) {
        return Err("Wait for the download to finish (or cancel it) first".into());
    }
    let dir = model_dir(&app, &id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| format!("Could not delete {}: {e}", dir.display()))?;
    }
    Ok(())
}
