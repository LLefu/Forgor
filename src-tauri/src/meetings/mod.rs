//! Meeting recordings: record mic + system audio, then transcribe and
//! summarize locally. The UI writes the resulting note; this module owns the
//! audio, the models and the tray / dock indicators.

pub mod models;
mod process;
mod recorder;

use recorder::Recorder;
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{image::Image, AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RecordingInfo {
    pub id: String,
    /// Unix time in milliseconds.
    pub started_at: u64,
    /// Set once the recording has stopped.
    pub duration_sec: Option<u64>,
    /// False when the system audio could not be recorded (only the microphone).
    pub system_audio: bool,
}

struct Active {
    info: RecordingInfo,
    recorder: Recorder,
}

#[derive(Default)]
pub struct MeetingsState {
    active: Mutex<Option<Active>>,
    /// Feature on and models ready: the tray offers "Start recording".
    available: Mutex<bool>,
    mic: Mutex<Option<String>>,
    processing: Mutex<HashSet<String>>,
}

impl MeetingsState {
    pub fn is_recording(&self) -> bool {
        self.active.lock().unwrap().is_some()
    }
    pub fn is_available(&self) -> bool {
        *self.available.lock().unwrap()
    }
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn recordings_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("recordings"))
}

fn recording_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    // Ids come from us, but the UI passes them back: never let one escape the folder.
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err(format!("Invalid recording id \"{id}\""));
    }
    Ok(recordings_dir(app)?.join(id))
}

fn write_meta(app: &AppHandle, info: &RecordingInfo) -> Result<(), String> {
    let path = recording_dir(app, &info.id)?.join("meta.json");
    std::fs::write(path, serde_json::to_vec(info).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

/// Tell every window (and the tray / dock) that the recording state changed.
fn notify(app: &AppHandle, stopped: Option<&RecordingInfo>) {
    let state = app.state::<MeetingsState>();
    let current = state.active.lock().unwrap().as_ref().map(|a| a.info.clone());
    let _ = app.emit("wn://recording", serde_json::json!({ "current": current, "stopped": stopped }));
    crate::refresh_tray(app);
    set_badge(app, current.is_some());
}

// ---------------------------------------------------------------- recording

pub fn start(app: &AppHandle) -> Result<RecordingInfo, String> {
    let state = app.state::<MeetingsState>();
    let mut active = state.active.lock().unwrap();
    if let Some(a) = active.as_ref() {
        return Ok(a.info.clone());
    }
    let id = format!("{}", now_ms());
    let dir = recording_dir(app, &id)?;
    let mic = state.mic.lock().unwrap().clone();
    let recorder = Recorder::start(&dir, mic)?;
    let info = RecordingInfo { id, started_at: now_ms(), duration_sec: None, system_audio: recorder.system_audio };
    write_meta(app, &info)?;
    *active = Some(Active { info: info.clone(), recorder });
    drop(active);
    notify(app, None);
    watch_silence(app.clone(), info.id.clone());
    Ok(info)
}

/// Stop the recording and bring the main window up (it asks for a name and folder).
pub fn stop(app: &AppHandle) -> Result<Option<RecordingInfo>, String> {
    let state = app.state::<MeetingsState>();
    let Some(Active { mut info, recorder }) = state.active.lock().unwrap().take() else {
        return Ok(None);
    };
    let result = recorder.stop();
    info.duration_sec = Some(now_ms().saturating_sub(info.started_at) / 1000);
    let _ = write_meta(app, &info);
    notify(app, Some(&info));
    crate::show_main(app);
    result.map(|_| Some(info))
}

/// On quit: close the audio files properly, without the "name it" flow. The
/// recording is picked up and processed on the next start.
pub fn finish_for_quit(app: &AppHandle) {
    let state = app.state::<MeetingsState>();
    let Some(Active { mut info, recorder }) = state.active.lock().unwrap().take() else { return };
    let _ = recorder.stop();
    info.duration_sec = Some(now_ms().saturating_sub(info.started_at) / 1000);
    let _ = write_meta(app, &info);
}

#[tauri::command]
pub fn meetings_start(app: AppHandle) -> Result<RecordingInfo, String> {
    start(&app)
}

#[tauri::command]
pub fn meetings_stop(app: AppHandle) -> Result<Option<RecordingInfo>, String> {
    stop(&app)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Levels {
    /// Current loudness 0..1 (RMS).
    mic: f32,
    system: f32,
    /// The mic delivered anything but exact zeros (no zeros = no permission or muted at the OS level).
    mic_signal: bool,
    system_audio: bool,
    elapsed_sec: f32,
    /// How long neither track has had sound.
    silent_sec: f32,
}

/// No sound for this long: "Still recording?".
const SILENCE_WARNING_SEC: f32 = 600.0;

fn levels_of(recorder: &Recorder) -> Levels {
    let now = recorder.started.elapsed().as_millis() as u64;
    let (mic, mic_signal, mic_heard) = recorder.mic_level.read(now);
    let (system, _, system_heard) = recorder.system_level.read(now);
    let heard = mic_heard.max(system_heard);
    Levels {
        mic,
        system,
        mic_signal,
        system_audio: recorder.system_audio,
        elapsed_sec: now as f32 / 1000.0,
        silent_sec: now.saturating_sub(heard) as f32 / 1000.0,
    }
}

/// Live levels while recording (None when not recording), for the meters and warnings.
#[tauri::command]
pub fn meetings_levels(state: tauri::State<'_, MeetingsState>) -> Option<Levels> {
    state.active.lock().unwrap().as_ref().map(|a| levels_of(&a.recorder))
}

/// While a recording runs: after 10 minutes without any sound, a notification
/// (once per silent stretch), in case the meeting ended and nobody stopped it.
fn watch_silence(app: AppHandle, id: String) {
    std::thread::spawn(move || {
        let mut warned = false;
        loop {
            std::thread::sleep(std::time::Duration::from_secs(15));
            let state = app.state::<MeetingsState>();
            let silent = match state.active.lock().unwrap().as_ref() {
                Some(a) if a.info.id == id => levels_of(&a.recorder).silent_sec,
                _ => return, // stopped
            };
            if silent >= SILENCE_WARNING_SEC && !warned {
                warned = true;
                use tauri_plugin_notification::NotificationExt;
                let _ = app
                    .notification()
                    .builder()
                    .title("Still recording?")
                    .body("Forgor hasn't heard anything for 10 minutes. Stop the recording from the tray icon or the quick menu if the meeting is over.")
                    .show();
            } else if silent < 60.0 {
                warned = false;
            }
        }
    });
}

#[tauri::command]
pub fn meetings_state(state: tauri::State<'_, MeetingsState>) -> Option<RecordingInfo> {
    state.active.lock().unwrap().as_ref().map(|a| a.info.clone())
}

/// The UI's settings that the tray needs: whether recording is offered, and which mic.
#[tauri::command]
pub fn meetings_configure(app: AppHandle, available: bool, mic: Option<String>) {
    let state = app.state::<MeetingsState>();
    *state.available.lock().unwrap() = available;
    *state.mic.lock().unwrap() = mic;
    crate::refresh_tray(&app);
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Devices {
    devices: Vec<String>,
    default: Option<String>,
}

#[tauri::command]
pub fn meetings_input_devices() -> Devices {
    use cpal::traits::HostTrait;
    let default = cpal::default_host().default_input_device().and_then(|d| recorder::device_name(&d));
    Devices { devices: recorder::input_device_names(), default }
}

/// Recordings on disk that are not being recorded right now: stopped ones
/// waiting to be processed, or ones cut off by a crash.
#[tauri::command]
pub fn meetings_recordings(app: AppHandle) -> Result<Vec<RecordingInfo>, String> {
    let dir = recordings_dir(&app)?;
    let active = app.state::<MeetingsState>().active.lock().unwrap().as_ref().map(|a| a.info.id.clone());
    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let Ok(bytes) = std::fs::read(entry.path().join("meta.json")) else { continue };
        let Ok(mut info) = serde_json::from_slice::<RecordingInfo>(&bytes) else { continue };
        if Some(&info.id) == active.as_ref() {
            continue;
        }
        if info.duration_sec.is_none() {
            // Cut off by a crash: estimate the length from the audio that made it to disk.
            let len = std::fs::metadata(entry.path().join(recorder::MIC_FILE)).map(|m| m.len()).unwrap_or(0);
            info.duration_sec = Some(len / (2 * recorder::SAMPLE_RATE as u64));
        }
        out.push(info);
    }
    out.sort_by_key(|i| i.started_at);
    Ok(out)
}

/// Delete a recording's audio (after its note is saved, or when discarded).
#[tauri::command]
pub fn meetings_discard(app: AppHandle, id: String) -> Result<(), String> {
    let dir = recording_dir(&app, &id)?;
    if dir.exists() {
        std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------- processing

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessResult {
    language: &'static str,
    segments: Vec<process::Segment>,
    /// Voice fingerprint per separated speaker (to remember them once named).
    voices: HashMap<u32, Vec<f32>>,
    /// Speakers recognized as people named before (from `similarity` ≥ 0.6 the
    /// name is used; lower ones are suggestions).
    recognized: HashMap<u32, process::Match>,
    summary: Option<String>,
    /// Why there is no summary (model missing or failed); the transcript is still there.
    summary_error: Option<String>,
}

/// Transcribe and summarize a stopped recording. `language` is "auto", "nl" or "en".
/// Emits `wn://meeting-progress` events: { id, stage: "transcribing" | "summarizing", progress }.
#[tauri::command]
pub async fn meetings_process(app: AppHandle, id: String, language: String, voices: Vec<process::KnownVoice>) -> Result<ProcessResult, String> {
    let dir = recording_dir(&app, &id)?;
    if !dir.exists() {
        return Err("The audio of this recording is gone".into());
    }
    {
        let state = app.state::<MeetingsState>();
        if state.active.lock().unwrap().as_ref().is_some_and(|a| a.info.id == id) {
            return Err("This recording is still running".into());
        }
        if !state.processing.lock().unwrap().insert(id.clone()) {
            return Err("This recording is already being processed".into());
        }
    }
    let speech = models::model_dir(&app, "speech")?;
    let speakers_dir = models::model_dir(&app, "speakers")?;
    let summary_dir = models::model_dir(&app, "summary")?;
    let app2 = app.clone();
    let id2 = id.clone();
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<ProcessResult, String> {
        if !models::is_downloaded(&speech, models::find("speech")?) {
            return Err("Download the speech model first (Settings → Meeting recordings)".into());
        }
        let progress = |stage: &str, p: f32| {
            let _ = app2.emit("wn://meeting-progress", serde_json::json!({ "id": id2, "stage": stage, "progress": p }));
        };
        // Speaker separation is optional: without it the others are one "Anderen".
        let speakers = models::is_downloaded(&speakers_dir, models::find("speakers")?).then_some(speakers_dir.as_path());
        let process::Transcript { segments, prints } = process::transcribe(&dir, &speech, speakers, &progress)?;
        let recognized = process::match_voices(&prints, &voices);
        // Recognized people go into the summary by name.
        let names: HashMap<u32, String> = recognized.iter().filter(|(_, m)| m.similarity >= process::RECOGNIZE).map(|(id, m)| (*id, m.name.clone())).collect();
        let lang = match language.as_str() {
            "nl" => "nl",
            "en" => "en",
            _ => process::detect_language(&segments),
        };
        let summary_model = models::find("summary")?;
        let (summary, summary_error) = if segments.is_empty() {
            (None, None)
        } else if !models::is_downloaded(&summary_dir, summary_model) {
            (None, Some("The summary model isn't downloaded".to_string()))
        } else {
            match process::summarize(&segments, lang, &names, &summary_dir.join(summary_model.files[0].name), &progress) {
                Ok(s) => (Some(s), None),
                Err(e) => (None, Some(e)),
            }
        };
        Ok(ProcessResult { language: lang, segments, voices: prints, recognized, summary, summary_error })
    })
    .await
    .map_err(|e| format!("Processing crashed: {e}"))
    .and_then(|r| r);
    app.state::<MeetingsState>().processing.lock().unwrap().remove(&id);
    result
}

/// Summarize again from a stored transcript, e.g. after the user named the
/// speakers ("Spreker 2" → "Jeroen"). Only the summary step runs.
#[tauri::command]
pub async fn meetings_summarize(app: AppHandle, segments: Vec<process::Segment>, language: String, names: HashMap<u32, String>) -> Result<String, String> {
    let dir = models::model_dir(&app, "summary")?;
    let model = models::find("summary")?;
    if !models::is_downloaded(&dir, model) {
        return Err("The summary model isn't downloaded".into());
    }
    let lang = if language == "en" { "en" } else { "nl" };
    tauri::async_runtime::spawn_blocking(move || process::summarize(&segments, lang, &names, &dir.join(model.files[0].name), &|_, _| {}))
        .await
        .map_err(|e| format!("Summarizing crashed: {e}"))?
}

// ---------------------------------------------------------------- indicators

/// The app icon with a red "recording" dot in the bottom-right corner.
pub fn recording_icon(base: &Image<'_>) -> Image<'static> {
    let (w, h) = (base.width() as i64, base.height() as i64);
    let mut rgba = base.rgba().to_vec();
    let r = (w.min(h) as f64 * 0.24).max(3.0);
    let (cx, cy) = (w as f64 - r - 1.0, h as f64 - r - 1.0);
    for y in 0..h {
        for x in 0..w {
            let d = ((x as f64 + 0.5 - cx).powi(2) + (y as f64 + 0.5 - cy).powi(2)).sqrt();
            let px = ((y * w + x) * 4) as usize;
            if d <= r {
                rgba[px..px + 4].copy_from_slice(&[229, 57, 53, 255]);
            } else if d <= r + (r * 0.25).max(1.0) {
                rgba[px..px + 4].copy_from_slice(&[255, 255, 255, 255]); // ring, visible on dark and red icons
            }
        }
    }
    Image::new_owned(rgba, w as u32, h as u32)
}

/// A red dot on the Dock icon (macOS) / taskbar button (Windows) while recording.
fn set_badge(app: &AppHandle, recording: bool) {
    let Some(w) = app.get_webview_window("main") else { return };
    #[cfg(target_os = "macos")]
    let _ = w.set_badge_label(recording.then(|| "REC".to_string()));
    #[cfg(target_os = "windows")]
    let _ = w.set_overlay_icon(recording.then(|| red_dot(32)));
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let _ = (w, recording);
}

#[cfg(target_os = "windows")]
fn red_dot(size: u32) -> Image<'static> {
    let transparent = Image::new_owned(vec![0; (size * size * 4) as usize], size, size);
    recording_icon(&transparent)
}
