//! Turns a recording into a transcript (Silero VAD + Parakeet v3 via
//! sherpa-onnx) and a summary (Gemma 4 E4B via llama.cpp). Everything runs
//! locally; the caller runs this on a blocking thread.

use super::recorder::{read_track, MIC_FILE, SAMPLE_RATE, SYSTEM_FILE};
use llama_cpp_2::{
    context::params::LlamaContextParams,
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{params::LlamaModelParams, AddBos, LlamaModel},
    sampling::LlamaSampler,
};
use serde::{Deserialize, Serialize};
use sherpa_onnx::{
    FastClusteringConfig, OfflineRecognizer, OfflineRecognizerConfig, OfflineSpeakerDiarization, OfflineSpeakerDiarizationConfig,
    OfflineSpeakerSegmentationModelConfig, OfflineSpeakerSegmentationPyannoteModelConfig, OfflineTransducerModelConfig, SileroVadModelConfig,
    SpeakerEmbeddingExtractor, SpeakerEmbeddingExtractorConfig, VadModelConfig, VoiceActivityDetector,
};
use std::{collections::HashMap, num::NonZeroU32, path::Path, sync::OnceLock};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Segment {
    /// Seconds from the start of the recording.
    pub start: f32,
    pub end: f32,
    /// "me" (microphone), "others" (system audio) or "unknown" (mic only, e.g. an in-person meeting).
    pub speaker: String,
    /// Which of the others (or, in person, which voice): 1, 2, 3… in order of
    /// appearance. None when speaker separation isn't installed.
    #[serde(default)]
    pub speaker_id: Option<u32>,
    pub text: String,
}

/// A stretch of one voice from speaker separation (seconds; raw cluster id).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Turn {
    pub start: f32,
    pub end: f32,
    pub speaker: u32,
}

/// Progress callback: (stage, 0..1).
pub type OnProgress<'a> = &'a dyn Fn(&str, f32);

// ---------------------------------------------------------------- transcription

/// `speakers_model`: the speaker separation models, if installed.
pub fn transcribe(recording: &Path, speech_model: &Path, speakers_model: Option<&Path>, on_progress: OnProgress) -> Result<Transcript, String> {
    let mic = read_track(&recording.join(MIC_FILE))?;
    let system = read_track(&recording.join(SYSTEM_FILE))?;
    if mic.is_empty() && system.is_empty() {
        return Err("The recording is empty".into());
    }
    let recognizer = recognizer(speech_model)?;
    let total = (mic.len() + system.len()).max(1) as f32;
    let clock = std::time::Instant::now();
    let lap = |what: &str| {
        if std::env::var("FORGOR_DEBUG_TIME").is_ok() {
            eprintln!("[time] {what}: {:.1}s", clock.elapsed().as_secs_f32());
        }
    };

    // The others come in on the system track: tell their voices apart there.
    let system_turns = match speakers_model {
        Some(dir) if !system.is_empty() => {
            on_progress("transcribing", 0.0);
            diarize(&system, dir)?
        }
        _ => Vec::new(),
    };
    lap("speaker separation");
    let others = transcribe_track(&recognizer, speech_model, &system, "others", &system_turns, None, &|p| on_progress("transcribing", p * system.len() as f32 / total))?;
    // No one on the system track (an in-person meeting): the mic heard everyone, so separate its voices instead.
    let mic_turns = match speakers_model {
        Some(dir) if others.is_empty() && !mic.is_empty() => diarize(&mic, dir)?,
        _ => Vec::new(),
    };
    lap("system track");
    let base = system.len() as f32 / total;
    let (mic_env, system_env) = (envelope(&mic), envelope(&system));
    // Without headphones the mic also hears the others: cut those stretches out
    // of the mic before recognizing it (a segment can hold both the user and echo).
    let echo = echo_frames(&mic_env, &system_env, &others);
    lap("echo frames");
    let me = transcribe_track(&recognizer, speech_model, &mic, "me", &mic_turns, Some(&echo), &|p| on_progress("transcribing", base + p * mic.len() as f32 / total))?;
    let correlation = |m: &Segment| echo_correlation(m, &mic_env, &system_env);
    if std::env::var("FORGOR_DEBUG_ECHO").is_ok() {
        let frames = echo_frames(&mic_env, &system_env, &others);
        for m in &me {
            let (a, b) = ((m.start * 50.0) as usize, ((m.end * 50.0) as usize).min(frames.len()));
            let echo = frames[a.min(b)..b].iter().filter(|&&e| e).count() as f32 / (b - a.min(b)).max(1) as f32;
            let map: String = frames[a.min(b)..b].chunks(10).map(|c| if c.iter().filter(|&&e| e).count() > 5 { 'E' } else { '.' }).collect();
            eprintln!("{:6.1}-{:6.1} corr={:.2} echo%={:3.0} {map} | {}", m.start, m.end, correlation(m), echo * 100.0, m.text);
        }
    }
    lap("mic track");
    let mut segments = merge(me, others, correlation);
    let numbers = number_speakers(&mut segments);
    // Fingerprints of the separated voices, under their new numbers.
    let mut prints = HashMap::new();
    if let Some(dir) = speakers_model {
        let (track, turns) = if system_turns.is_empty() { (&mic, &mic_turns) } else { (&system, &system_turns) };
        for (raw, print) in voice_prints(track, turns, dir)? {
            if let Some(n) = numbers.get(&raw) {
                prints.insert(*n, print);
            }
        }
    }
    lap("voice prints");
    Ok(Transcript { segments, prints })
}

fn recognizer(dir: &Path) -> Result<OfflineRecognizer, String> {
    let file = |name: &str| Some(dir.join(name).to_string_lossy().into_owned());
    let mut config = OfflineRecognizerConfig::default();
    config.model_config.transducer = OfflineTransducerModelConfig {
        encoder: file("encoder.int8.onnx"),
        decoder: file("decoder.int8.onnx"),
        joiner: file("joiner.int8.onnx"),
    };
    config.model_config.tokens = file("tokens.txt");
    config.model_config.model_type = Some("nemo_transducer".into());
    config.model_config.num_threads = threads();
    OfflineRecognizer::create(&config).ok_or_else(|| "Could not load the speech model; try deleting and downloading it again".into())
}

fn transcribe_track(
    recognizer: &OfflineRecognizer,
    model_dir: &Path,
    samples: &[f32],
    speaker: &'static str,
    turns: &[Turn],
    exclude: Option<&[bool]>,
    on_progress: &dyn Fn(f32),
) -> Result<Vec<Segment>, String> {
    if samples.is_empty() {
        return Ok(Vec::new());
    }
    let mut config = VadModelConfig::default();
    config.silero_vad = SileroVadModelConfig {
        model: Some(model_dir.join("silero_vad.onnx").to_string_lossy().into_owned()),
        threshold: 0.5,
        min_silence_duration: 0.5,
        // Short replies ("ja", "klopt") are part of a meeting too.
        min_speech_duration: 0.1,
        window_size: 512,
        // Cap segments so timestamps stay useful.
        max_speech_duration: 25.0,
    };
    config.sample_rate = SAMPLE_RATE as i32;
    config.num_threads = 1;
    let vad = VoiceActivityDetector::create(&config, 60.0).ok_or("Could not load the voice detector")?;

    // 1. Find the speech (on its own this is fast).
    let mut found: Vec<(usize, Vec<f32>)> = Vec::new();
    for chunk in samples.chunks(512) {
        vad.accept_waveform(chunk);
        while let Some(seg) = vad.front() {
            vad.pop();
            found.push((seg.start().max(0) as usize, seg.samples().to_vec()));
        }
    }
    vad.flush();
    while let Some(seg) = vad.front() {
        vad.pop();
        found.push((seg.start().max(0) as usize, seg.samples().to_vec()));
    }
    // Drop the frames marked to exclude (echo), keeping the rest of each segment.
    let found: Vec<(usize, Vec<f32>)> = match exclude {
        Some(mask) => found.into_iter().flat_map(|(at, audio)| cut_out(at, &audio, mask)).collect(),
        None => found,
    };
    // A pause-free change of speaker is still one VAD segment: cut it there.
    let found: Vec<(usize, Vec<f32>, Option<u32>)> = if turns.is_empty() {
        found.into_iter().map(|(at, audio)| (at, audio, None)).collect()
    } else {
        found.into_iter().flat_map(|(at, audio)| split_at_speakers(at, &audio, turns)).collect()
    };

    // 2. Long segments are recognized on their own. Short ones get the preceding
    //    ~6 s of speech on this track as context (only their own words are kept):
    //    alone, Parakeet often takes a Dutch "ja" or "wel fijn" for English, while
    //    joining long segments made it skip parts of sentences. Measured on Dutch
    //    conversations with human subtitles: 12.2% word errors vs 13.5% (all alone)
    //    and 13.7% (everything joined); 15.5% vs 19.0% / 18.5% on call-quality audio.
    let mut segments = Vec::new();
    let total = found.len().max(1);
    for (i, (at, audio, speaker_id)) in found.iter().enumerate() {
        let text = if audio.len() >= SHORT_SEGMENT {
            decode(recognizer, audio).map(|r| r.text).unwrap_or_default()
        } else {
            let mut joined: Vec<f32> = Vec::new();
            for (_, a, _) in found[..i].iter().rev() {
                let mut piece = a.clone();
                piece.extend(std::iter::repeat_n(0.0, JOIN_GAP));
                piece.extend(joined);
                joined = piece;
                if joined.len() >= CONTEXT_SAMPLES {
                    break;
                }
            }
            if joined.len() > CONTEXT_SAMPLES {
                joined.drain(..joined.len() - CONTEXT_SAMPLES);
            }
            if joined.is_empty() {
                // At the very start: the following speech is the context instead.
                joined.extend_from_slice(audio);
                let offset = joined.len() + JOIN_GAP;
                for (_, a, _) in &found[i + 1..] {
                    joined.extend(std::iter::repeat_n(0.0, JOIN_GAP));
                    joined.extend_from_slice(a);
                    if joined.len() >= offset + CONTEXT_SAMPLES {
                        break;
                    }
                }
                let r = decode(recognizer, &joined);
                r.map(|r| split_by_time(&r.tokens, r.timestamps.as_deref().unwrap_or(&[]), &[0, offset]).swap_remove(0)).unwrap_or_default()
            } else {
                let offset = joined.len();
                joined.extend_from_slice(audio);
                let r = decode(recognizer, &joined);
                r.map(|r| split_by_time(&r.tokens, r.timestamps.as_deref().unwrap_or(&[]), &[0, offset]).swap_remove(1)).unwrap_or_default()
            }
        };
        let text = text.trim().to_string();
        if !text.is_empty() {
            let start = *at as f32 / SAMPLE_RATE as f32;
            let end = start + audio.len() as f32 / SAMPLE_RATE as f32;
            segments.push(Segment { start, end, speaker: speaker.into(), speaker_id: *speaker_id, text });
        }
        if i % 10 == 0 {
            on_progress(i as f32 / total as f32);
        }
    }
    on_progress(1.0);
    Ok(segments)
}

/// Tell the voices on a track apart (pyannote segmentation + CAM++ voice
/// embeddings, clustered). Returns who spoke when.
fn diarize(samples: &[f32], dir: &Path) -> Result<Vec<Turn>, String> {
    let file = |name: &str| Some(dir.join(name).to_string_lossy().into_owned());
    let config = OfflineSpeakerDiarizationConfig {
        segmentation: OfflineSpeakerSegmentationModelConfig {
            pyannote: OfflineSpeakerSegmentationPyannoteModelConfig { model: file("segmentation.onnx"), ..Default::default() },
            num_threads: threads(),
            ..Default::default()
        },
        embedding: SpeakerEmbeddingExtractorConfig { model: file("embedding.onnx"), num_threads: threads(), ..Default::default() },
        // Distance threshold (larger = fewer speakers). The default 0.5 split one
        // standup into ~80 "speakers" (call audio varies a lot); 0.9 matched the
        // actual people, merging two of seven.
        clustering: FastClusteringConfig { threshold: 0.9, ..Default::default() },
        min_duration_on: 0.2,
        min_duration_off: 0.5,
    };
    let sd = OfflineSpeakerDiarization::create(&config).ok_or("Could not load the speaker separation models; try deleting and downloading them again")?;
    let result = sd.process(samples).ok_or("Speaker separation failed")?;
    Ok(result.sort_by_start_time().into_iter().map(|t| Turn { start: t.start, end: t.end, speaker: t.speaker.max(0) as u32 }).collect())
}

/// A voice fingerprint (CAM++ embedding, unit length) per speaker on a track,
/// from up to a minute of their clearest speech (turns of at least 1.5 s).
/// Used to recognize people in later meetings once the user named them.
pub fn voice_prints(samples: &[f32], turns: &[Turn], dir: &Path) -> Result<HashMap<u32, Vec<f32>>, String> {
    let config = SpeakerEmbeddingExtractorConfig { model: Some(dir.join("embedding.onnx").to_string_lossy().into_owned()), num_threads: threads(), ..Default::default() };
    let extractor = SpeakerEmbeddingExtractor::create(&config).ok_or("Could not load the voice model")?;
    let mut by_speaker: HashMap<u32, Vec<&Turn>> = HashMap::new();
    for t in turns.iter().filter(|t| t.end - t.start >= 1.5) {
        by_speaker.entry(t.speaker).or_default().push(t);
    }
    let mut out = HashMap::new();
    for (speaker, mut list) in by_speaker {
        list.sort_by(|a, b| (b.end - b.start).total_cmp(&(a.end - a.start))); // longest first
        let mut sum: Vec<f32> = Vec::new();
        let mut used = 0.0;
        for t in list {
            if used >= 60.0 {
                break;
            }
            let from = ((t.start * SAMPLE_RATE as f32) as usize).min(samples.len());
            let to = ((t.end.min(t.start + 15.0) * SAMPLE_RATE as f32) as usize).min(samples.len());
            let Some(stream) = extractor.create_stream() else { continue };
            stream.accept_waveform(SAMPLE_RATE as i32, &samples[from..to]);
            stream.input_finished();
            if !extractor.is_ready(&stream) {
                continue;
            }
            let Some(e) = extractor.compute(&stream) else { continue };
            let e = normalize(e);
            let w = (to - from) as f32 / SAMPLE_RATE as f32;
            if sum.is_empty() {
                sum = vec![0.0; e.len()];
            }
            for (a, b) in sum.iter_mut().zip(&e) {
                *a += b * w;
            }
            used += w;
        }
        if !sum.is_empty() {
            out.insert(speaker, normalize(sum));
        }
    }
    Ok(out)
}

fn normalize(v: Vec<f32>) -> Vec<f32> {
    let n = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if n == 0.0 {
        v
    } else {
        v.into_iter().map(|x| x / n).collect()
    }
}

/// Cosine similarity of two unit-length fingerprints.
pub fn similarity_of(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b).map(|(x, y)| x * y).sum()
}

/// Cut a VAD segment (starting at sample `at`) where the speaker changes. Each
/// 20 ms frame takes the voice of the turn covering it (the longest when turns
/// overlap); frames between turns keep the previous voice. Pieces shorter than
/// 0.6 s are folded into their neighbour: they are usually separation noise.
fn split_at_speakers(at: usize, audio: &[f32], turns: &[Turn]) -> Vec<(usize, Vec<f32>, Option<u32>)> {
    let frame = SAMPLE_RATE as usize / 50;
    let n = audio.len().div_ceil(frame);
    let mut who: Vec<Option<u32>> = (0..n)
        .map(|i| {
            let t = (at + i * frame + frame / 2) as f32 / SAMPLE_RATE as f32;
            turns.iter().filter(|tr| tr.start <= t && t < tr.end).max_by(|a, b| (a.end - a.start).total_cmp(&(b.end - b.start))).map(|tr| tr.speaker)
        })
        .collect();
    for i in 1..n {
        if who[i].is_none() {
            who[i] = who[i - 1];
        }
    }
    let first = who.iter().find_map(|w| *w);
    for w in who.iter_mut() {
        if w.is_none() {
            *w = first;
        } else {
            break;
        }
    }
    // Runs of one voice; short runs join the previous one (or the next, at the start).
    let mut runs: Vec<(usize, usize, Option<u32>)> = Vec::new(); // (first frame, frames, voice)
    for (i, w) in who.iter().enumerate() {
        match runs.last_mut() {
            Some(r) if r.2 == *w => r.1 += 1,
            _ => runs.push((i, 1, *w)),
        }
    }
    let min = 30; // frames = 0.6 s
    let mut merged: Vec<(usize, usize, Option<u32>)> = Vec::new();
    for r in runs {
        match merged.last_mut() {
            Some(last) if r.1 < min => last.1 += r.1,
            Some(last) if last.1 < min => {
                *last = (last.0, last.1 + r.1, r.2);
            }
            Some(last) if last.2 == r.2 => last.1 += r.1,
            _ => merged.push(r),
        }
    }
    merged
        .into_iter()
        .map(|(f, len, w)| {
            let from = (f * frame).min(audio.len());
            let to = ((f + len) * frame).min(audio.len());
            (at + from, audio[from..to].to_vec(), w)
        })
        .filter(|p| !p.1.is_empty())
        .collect()
}

/// The parts of a segment (starting at sample `at`) outside the masked 20 ms
/// frames. Masked runs under 0.3 s are ignored (noise in the mask); kept pieces
/// under 0.4 s are dropped, and under 1 s when they sit between two cuts (on a
/// real call those slivers came out as stray words like "maybe").
fn cut_out(at: usize, audio: &[f32], mask: &[bool]) -> Vec<(usize, Vec<f32>)> {
    let frame = SAMPLE_RATE as usize / 50;
    let n = audio.len().div_ceil(frame);
    let masked: Vec<bool> = (0..n).map(|i| mask.get(at / frame + i).copied().unwrap_or(false)).collect();
    // Ignore short masked runs.
    let mut keep = vec![true; n];
    let mut i = 0;
    while i < n {
        if masked[i] {
            let j = (i..n).find(|&j| !masked[j]).unwrap_or(n);
            if j - i >= 15 {
                keep[i..j].iter_mut().for_each(|k| *k = false);
            }
            i = j;
        } else {
            i += 1;
        }
    }
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        if !keep[i] {
            i += 1;
            continue;
        }
        let j = (i..n).find(|&j| !keep[j]).unwrap_or(n);
        // A piece between two cut-out stretches is usually leftover echo unless it is
        // long enough to be the user; a short segment that wasn't cut ("ja") stays.
        let between_cuts = i > 0 && j < n;
        if (i == 0 && j == n) || j - i >= if between_cuts { 50 } else { 20 } {
            let (from, to) = (i * frame, (j * frame).min(audio.len()));
            out.push((at + from, audio[from..to].to_vec()));
        }
        i = j;
    }
    out
}

/// Raw cluster ids → 1, 2, 3… in the order the voices first speak. Returns raw → number.
fn number_speakers(segments: &mut [Segment]) -> HashMap<u32, u32> {
    let mut order: HashMap<u32, u32> = HashMap::new();
    for s in segments.iter_mut() {
        if let Some(raw) = s.speaker_id {
            let next = order.len() as u32 + 1;
            s.speaker_id = Some(*order.entry(raw).or_insert(next));
        }
    }
    order
}

/// A voice the user named in an earlier meeting.
#[derive(Deserialize, Clone, Debug)]
pub struct KnownVoice {
    pub name: String,
    pub print: Vec<f32>,
}

/// Fingerprints at least this similar are the same person (a name is filled in).
/// On a real standup the same voice scored 0.57–0.89, other people at most 0.47.
pub const RECOGNIZE: f32 = 0.6;
/// From here a name is only suggested.
pub const SUGGEST: f32 = 0.5;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Match {
    pub name: String,
    pub similarity: f32,
}

/// Best known voice per speaker, each name used at most once (the closest
/// speaker gets it). Matches below `SUGGEST` are left out.
pub fn match_voices(prints: &HashMap<u32, Vec<f32>>, known: &[KnownVoice]) -> HashMap<u32, Match> {
    let mut pairs: Vec<(f32, u32, &str)> = Vec::new();
    for (id, print) in prints {
        for k in known {
            if k.print.len() == print.len() {
                pairs.push((similarity_of(print, &k.print), *id, &k.name));
            }
        }
    }
    pairs.sort_by(|a, b| b.0.total_cmp(&a.0));
    let mut out: HashMap<u32, Match> = HashMap::new();
    for (sim, id, name) in pairs {
        if sim < SUGGEST || out.contains_key(&id) || out.values().any(|m| m.name == name) {
            continue;
        }
        out.insert(id, Match { name: name.to_string(), similarity: sim });
    }
    out
}

/// What processing found: the transcript and a voice fingerprint per separated speaker.
pub struct Transcript {
    pub segments: Vec<Segment>,
    pub prints: HashMap<u32, Vec<f32>>,
}

fn decode(recognizer: &OfflineRecognizer, audio: &[f32]) -> Option<sherpa_onnx::OfflineRecognizerResult> {
    let stream = recognizer.create_stream();
    stream.accept_waveform(SAMPLE_RATE as i32, audio);
    recognizer.decode(&stream);
    stream.get_result()
}

/// Segments shorter than this get context from the speech before them.
const SHORT_SEGMENT: usize = 3 * SAMPLE_RATE as usize;
/// How much preceding speech a short segment gets as context.
const CONTEXT_SAMPLES: usize = 6 * SAMPLE_RATE as usize;
/// Silence between joined segments. Longer pauses make the model treat the
/// pieces as unrelated again; shorter ones make the split by time unreliable.
const JOIN_GAP: usize = SAMPLE_RATE as usize * 6 / 10;

/// Split recognized tokens back into the joined segments (starting at `offsets`,
/// in samples). Whole words go to the segment their first piece starts in; the
/// boundary sits in the middle of the silence, because token times run early.
fn split_by_time(tokens: &[String], timestamps: &[f32], offsets: &[usize]) -> Vec<String> {
    let mut texts = vec![String::new(); offsets.len()];
    let mut idx = 0;
    for (k, token) in tokens.iter().enumerate() {
        if k == 0 || token.starts_with(' ') || token.starts_with('\u{2581}') {
            let at = (timestamps.get(k).copied().unwrap_or(0.0).max(0.0) * SAMPLE_RATE as f32) as usize;
            idx = offsets.iter().rposition(|&o| at + JOIN_GAP / 2 >= o).unwrap_or(0);
        }
        texts[idx].push_str(token);
    }
    texts.into_iter().map(|t| t.replace('\u{2581}', " ").split_whitespace().collect::<Vec<_>>().join(" ")).collect()
}

/// Combine both tracks on one timeline.
/// - Without headphones the mic also hears the others. Such echo is dropped: its
///   loudness follows the system audio (`correlation`, see `echo_correlation`),
///   or it repeats the words said on the system track at that moment.
/// - When the system track has no speech at all (an in-person meeting), the mic
///   heard everyone, so its segments are not attributed to "me".
pub fn merge(me: Vec<Segment>, others: Vec<Segment>, correlation: impl Fn(&Segment) -> f32) -> Vec<Segment> {
    let in_person = others.is_empty();
    let mut all: Vec<Segment> = me
        .into_iter()
        .filter(|m| {
            // Measured on a real call without headphones: echo 0.84–0.98, the user's own voice 0.12–0.70.
            let c = correlation(m);
            !(c >= 0.78 || (c >= 0.6 && is_echo(m, &others)))
        })
        .map(|mut m| {
            if in_person {
                m.speaker = "unknown".into();
            }
            m
        })
        .collect();
    all.extend(others);
    all.sort_by(|a, b| a.start.total_cmp(&b.start));
    all
}

/// A mic segment is an echo of the speakers when most of its words were said on
/// the system track around the same time. The tracks cut sentences at different
/// points, so it is compared with all system speech nearby, not one segment.
fn is_echo(m: &Segment, others: &[Segment]) -> bool {
    let nearby: Vec<&Segment> = others.iter().filter(|o| o.end > m.start - 2.0 && o.start < m.end + 2.0).collect();
    if nearby.is_empty() {
        return false;
    }
    let mine = content_words(&m.text);
    let at_same_time: Vec<&&Segment> = nearby.iter().filter(|o| m.end.min(o.end) - m.start.max(o.start) > 0.5 * (m.end - m.start)).collect();
    if mine.is_empty() {
        // Only common words ("ja", "oké"): an echo of an equally short reply at the same moment.
        return at_same_time.iter().any(|o| words(&o.text).len() <= 4 && similarity(&m.text, &o.text) >= 0.6);
    }
    if mine.len() < 3 {
        // Few meaningful words: an echo when exactly those were said at the same moment.
        let theirs: std::collections::HashSet<String> = at_same_time.iter().flat_map(|o| content_words(&o.text)).collect();
        return mine.iter().all(|w| theirs.contains(w));
    }
    let theirs: std::collections::HashSet<String> = nearby.iter().flat_map(|o| content_words(&o.text)).collect();
    mine.iter().filter(|w| theirs.contains(*w)).count() as f32 / mine.len() as f32 >= 0.6
}

/// Per 20 ms frame of the mic: is it echo of the speakers? True where the
/// system track has speech and the mic's loudness follows it closely over the
/// surrounding second (at the echo delay of this recording). Lets echo be cut
/// out of a mic segment that also has the user's own voice in it.
pub fn echo_frames(mic: &[f32], system: &[f32], system_speech: &[Segment]) -> Vec<bool> {
    let n = mic.len().min(system.len());
    let mut active = vec![false; n];
    for s in system_speech {
        let (a, b) = (((s.start * 50.0) as usize).min(n), ((s.end * 50.0) as usize + 15).min(n));
        active[a..b].iter_mut().for_each(|x| *x = true);
    }
    if !active.iter().any(|&a| a) {
        return vec![false; mic.len()];
    }
    // The delay from speaker to mic is fairly constant: find it once over all system speech.
    let idx: Vec<usize> = (0..n).filter(|&i| active[i]).collect();
    let best_lag = (0..=15usize)
        .max_by(|&a, &b| {
            let c = |lag: usize| {
                let (x, y): (Vec<f32>, Vec<f32>) = idx.iter().filter(|&&i| i >= lag).map(|&i| (mic[i], system[i - lag])).unzip();
                pearson(&x, &y)
            };
            c(a).total_cmp(&c(b))
        })
        .unwrap_or(0);
    const HALF: usize = 25; // ±0.5 s
    (0..mic.len())
        .map(|i| {
            if i >= n || !active[i] || i < best_lag {
                return false;
            }
            let (a, b) = (i.saturating_sub(HALF).max(best_lag), (i + HALF).min(n));
            let x = &mic[a..b];
            let y = &system[a - best_lag..b - best_lag];
            pearson(x, y) >= ECHO_FRAME_CORRELATION
        })
        .collect()
}

/// Loudness per 20 ms frame (log RMS), for comparing the tracks acoustically.
fn envelope(samples: &[f32]) -> Vec<f32> {
    samples
        .chunks(FRAME)
        .map(|f| ((f.iter().map(|x| x * x).sum::<f32>() / f.len() as f32).sqrt() + 1e-4).log10())
        .collect()
}

const FRAME: usize = SAMPLE_RATE as usize / 50;
/// Frame-level echo threshold (see `echo_frames`). Swept 0.6–0.8 on two real
/// calls without headphones: 0.6 removed all echo and kept all of the user's own
/// phrases (0.7+ started dropping the user's own short replies).
const ECHO_FRAME_CORRELATION: f32 = 0.6;

/// How closely the mic's loudness follows the system audio during a mic
/// segment (best Pearson correlation over a small delay range). Echo from the
/// speakers follows it closely; the user's own voice doesn't.
fn echo_correlation(m: &Segment, mic: &[f32], system: &[f32]) -> f32 {
    let a = (m.start * 50.0) as isize;
    let b = ((m.end * 50.0) as isize).min(mic.len() as isize);
    if b - a < 10 {
        return 0.0;
    }
    let mut best = 0f32;
    // The echo reaches the mic slightly after the system output (or a little before, from buffering).
    for lag in -10isize..=25 {
        let (x0, y0) = (a, a - lag);
        if y0 < 0 || y0 + (b - a) > system.len() as isize {
            continue;
        }
        let x = &mic[x0 as usize..b as usize];
        let y = &system[y0 as usize..(y0 + (b - a)) as usize];
        best = best.max(pearson(x, y));
    }
    best
}

fn pearson(x: &[f32], y: &[f32]) -> f32 {
    let n = x.len() as f32;
    let (mx, my) = (x.iter().sum::<f32>() / n, y.iter().sum::<f32>() / n);
    let (mut sxy, mut sxx, mut syy) = (0f32, 0f32, 0f32);
    for (a, b) in x.iter().zip(y) {
        sxy += (a - mx) * (b - my);
        sxx += (a - mx) * (a - mx);
        syy += (b - my) * (b - my);
    }
    if sxx == 0.0 || syy == 0.0 {
        0.0
    } else {
        sxy / (sxx * syy).sqrt()
    }
}

/// Words that carry meaning (not "de", "ja", "the"…), for comparing tracks.
fn content_words(text: &str) -> Vec<String> {
    const COMMON: &[&str] = &[
        "de", "het", "een", "en", "of", "ja", "nee", "nou", "oké", "ok", "okay", "dat", "die", "dit", "deze", "is", "was", "zijn", "ben", "bent",
        "heb", "hebt", "heeft", "ik", "je", "jij", "we", "wij", "ze", "zij", "hij", "het", "er", "in", "op", "aan", "van", "voor", "met", "naar",
        "om", "te", "ook", "maar", "wel", "niet", "nog", "dan", "als", "wat", "zo", "dus", "even", "gewoon", "goed", "kan", "moet", "wil",
        "the", "a", "an", "and", "or", "yes", "yeah", "no", "so", "it", "is", "to", "of", "in", "on", "for", "with", "that", "this", "you", "we",
        "i", "be", "are", "was", "have", "do", "not", "but", "just", "good", "uh", "um", "eh", "hè",
    ];
    words(text).into_iter().filter(|w| !COMMON.contains(&w.as_str())).collect()
}

fn words(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric()).filter(|w| !w.is_empty()).map(str::to_lowercase).collect()
}

/// Share of `a`'s words that also occur in `b` (0..1).
fn similarity(a: &str, b: &str) -> f32 {
    let a = words(a);
    if a.is_empty() {
        return 0.0;
    }
    let b: std::collections::HashSet<String> = words(b).into_iter().collect();
    a.iter().filter(|w| b.contains(*w)).count() as f32 / a.len() as f32
}

/// "nl" or "en", from common function words (Parakeet doesn't report the language).
pub fn detect_language(segments: &[Segment]) -> &'static str {
    const NL: &[&str] = &["de", "het", "een", "en", "ik", "je", "niet", "dat", "van", "zijn", "voor", "met", "op", "ook", "maar", "wel", "nog", "wat", "dan"];
    const EN: &[&str] = &["the", "and", "to", "of", "you", "that", "it", "for", "with", "on", "this", "not", "but", "are", "have", "what", "so", "just"];
    let (mut nl, mut en) = (0, 0);
    for s in segments {
        for w in words(&s.text) {
            nl += NL.contains(&w.as_str()) as usize;
            en += EN.contains(&w.as_str()) as usize;
        }
    }
    if en > nl {
        "en"
    } else {
        "nl"
    }
}

// ---------------------------------------------------------------- summary

fn backend() -> Result<&'static LlamaBackend, String> {
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

/// The model sees "Opnemer" / "Deelnemer" ("Recorder" / "Participant"), not the
/// note's "Ik" / "Anderen": in Dutch "ik" is also just "I", so a line like
/// "Anderen: Ik ben bezig met…" made it hand the others' tasks to the user.
struct Prompts {
    me: &'static str,
    others: &'static str,
    unknown: &'static str,
    /// What `me` becomes in the summary the user reads.
    me_out: &'static str,
    /// Separated voices: "Spreker 1", "Spreker 2"…
    numbered: &'static str,
    system: &'static str,
    part: &'static str,
    combine: &'static str,
}

fn prompts(lang: &str) -> Prompts {
    if lang == "en" {
        Prompts {
            me: "Recorder",
            others: "Participant",
            unknown: "Speaker",
            me_out: "Me",
            numbered: "Speaker",
            system: "You summarize meeting transcripts. Each line starts with who spoke: \"Recorder\" is the person who recorded the meeting; \"Participant\" is any of the other participants (their voices are not told apart, so \"Participant\" can be someone different each time). A name or \"Speaker 1\", \"Speaker 2\"… is the same person every time (the numbers were assigned automatically and may occasionally merge two people).\n\
Write in English, in exactly this markdown structure and nothing else:\n\n\
## Summary\n2-4 sentences: what the meeting was about and its outcome.\n\n\
## Key points\n- one bullet per topic\n\n\
## Decisions\n- everything that was agreed or decided, including ways of working and when people meet again\n\n\
## Action items\n- Name: what (and when, if it was said)\n\n\
Action items: include every concrete task someone says they will do or must do, also in a stand-up (\"today I'll…\", \"I'll finish…\", \"then I'll pick up…\"), one line per task. When someone asks another person to do something (\"can you…\", \"add me\"), it is that other person's action item. Name the person when the conversation makes clear who it is (they are addressed, name themselves, or are given the floor: \"Who hasn't gone yet, Emma?\" means Emma speaks next). Write \"Recorder\" only for what is in a \"Recorder\" line. If someone only has a number, use \"Speaker 2\" and so on. If it isn't clear who will do it, leave out the name and start with the verb. Never use \"Participant\" as a name. Don't use the words Recorder and Participant in the summary, key points and decisions.\n\
Only use facts from the transcript. Never invent names, dates or numbers. If a heading has nothing, write \"- None\".",
            part: "Summarize this part of a meeting transcript in English as a short bulleted list of topics, decisions and action items (with the name of who does it when the conversation makes it clear, and when). \"Recorder\" recorded the meeting; \"Participant\" is any of the other participants. Only use facts from the text.",
            combine: "Below are notes on consecutive parts of one meeting. Combine them into one summary. Keep every action item and decision from the notes (merging duplicates), also those that appear in only one part.",
        }
    } else {
        Prompts {
            me: "Opnemer",
            others: "Deelnemer",
            unknown: "Spreker",
            me_out: "Ik",
            numbered: "Spreker",
            system: "Je vat vergadertranscripten samen. Elke regel begint met wie er sprak: \"Opnemer\" is degene die de vergadering heeft opgenomen; \"Deelnemer\" zijn alle andere deelnemers samen (hun stemmen zijn niet uit elkaar gehouden, dus \"Deelnemer\" kan elke keer iemand anders zijn). Staat er een naam of \"Spreker 1\", \"Spreker 2\"…, dan is dat steeds dezelfde persoon (de nummers zijn automatisch toegekend en kunnen af en toe twee mensen samenvoegen).\n\
Schrijf in het Nederlands, in precies deze markdown-structuur en verder niets:\n\n\
## Samenvatting\n2-4 zinnen: waar de vergadering over ging en wat het resultaat was.\n\n\
## Belangrijkste punten\n- één punt per onderwerp\n\n\
## Besluiten\n- alles wat is afgesproken of besloten, ook afspraken over werkwijze en wanneer men elkaar weer ziet\n\n\
## Actiepunten\n- Naam: wat (en wanneer, als dat gezegd is)\n\n\
Actiepunten: neem elke concrete taak op die iemand zegt te gaan doen of moet doen, ook in een standup (\"vandaag ga ik…\", \"ik rond … af\", \"daarna pak ik … op\"), één regel per taak. Vraagt iemand een ander iets te doen (\"kun jij…\", \"voeg mij toe\"), dan is het een actiepunt van die ander. Noem de persoon bij naam als uit het gesprek blijkt wie het is (iemand wordt aangesproken, noemt zichzelf, of krijgt het woord: \"Wie is nog niet geweest, Germen?\" betekent dat Germen daarna spreekt). Schrijf \"Opnemer\" alleen bij wat in een regel van \"Opnemer\" staat. Heeft iemand alleen een nummer, gebruik dan \"Spreker 2\" enzovoort. Is niet duidelijk wie het doet, laat de naam dan weg en begin met het werkwoord. Schrijf nooit \"Deelnemer\" als naam. Gebruik de woorden Opnemer en Deelnemer niet in de samenvatting, de punten en de besluiten.\n\
Gebruik alleen feiten uit het transcript. Verzin nooit namen, datums of getallen. Is er niets voor een kopje, schrijf dan \"- Geen\".",
            part: "Vat dit deel van een vergadertranscript samen in het Nederlands als een korte lijst met onderwerpen, besluiten en actiepunten (met de naam van wie het doet als die blijkt uit het gesprek, en wanneer). \"Opnemer\" is degene die opnam; \"Deelnemer\" zijn alle andere deelnemers samen. Gebruik alleen feiten uit de tekst.",
            combine: "Hieronder staan aantekeningen van opeenvolgende delen van één vergadering. Voeg ze samen tot één samenvatting. Neem alle actiepunten en besluiten uit de aantekeningen over (dubbele samengevoegd), ook als ze maar in één deel staan.",
        }
    }
}

/// The transcript as the summary model reads it. `names`: speakers the user named.
pub fn transcript_text(segments: &[Segment], lang: &str, names: &HashMap<u32, String>) -> String {
    let p = prompts(lang);
    segments
        .iter()
        .map(|s| {
            let t = s.start as u32;
            let who = match (s.speaker.as_str(), s.speaker_id) {
                ("me", _) => p.me.to_string(),
                (_, Some(id)) => names.get(&id).cloned().unwrap_or_else(|| format!("{} {id}", p.numbered)),
                ("others", None) => p.others.to_string(),
                _ => p.unknown.to_string(),
            };
            format!("[{:02}:{:02}] {who}: {}\n", t / 60, t % 60, s.text)
        })
        .collect()
}

/// Gemma 4's chat format (llama.cpp's built-in template list doesn't know it).
fn gemma_prompt(system: &str, user: &str) -> String {
    format!("<|turn>system\n{system}<turn|>\n<|turn>user\n{user}<turn|>\n<|turn>model\n")
}

/// Transcripts up to this many tokens are summarized in one go; longer ones in parts.
const PART_TOKENS: usize = 24_000;
const MAX_OUTPUT: usize = 1_500;

pub fn summarize(segments: &[Segment], lang: &str, names: &HashMap<u32, String>, model_path: &Path, on_progress: OnProgress) -> Result<String, String> {
    if segments.is_empty() {
        return Ok(String::new());
    }
    let backend = backend()?;
    // All layers on the GPU where there is one (Metal on macOS); CPU otherwise.
    let model = LlamaModel::load_from_file(backend, model_path, &LlamaModelParams::default().with_n_gpu_layers(999))
        .map_err(|e| format!("Could not load the summary model: {e}"))?;
    let p = prompts(lang);
    let text = transcript_text(segments, lang, names);
    let tokens = model.str_to_token(&text, AddBos::Never).map_err(|e| e.to_string())?.len();

    if tokens <= PART_TOKENS {
        on_progress("summarizing", 0.1);
        let out = generate(backend, &model, &gemma_prompt(p.system, &text))?;
        on_progress("summarizing", 1.0);
        return Ok(relabel(&clean(&out), &p));
    }
    // Long meeting: summarize parts, then combine the part notes.
    let lines: Vec<&str> = text.lines().collect();
    let parts = tokens.div_ceil(PART_TOKENS);
    let per_part = lines.len().div_ceil(parts);
    let mut notes = String::new();
    for (i, chunk) in lines.chunks(per_part).enumerate() {
        on_progress("summarizing", i as f32 / (parts + 1) as f32);
        notes += &generate(backend, &model, &gemma_prompt(p.part, &chunk.join("\n")))?;
        notes += "\n\n";
    }
    on_progress("summarizing", parts as f32 / (parts + 1) as f32);
    let out = generate(backend, &model, &gemma_prompt(p.system, &format!("{}\n\n{notes}", p.combine)))?;
    on_progress("summarizing", 1.0);
    Ok(relabel(&clean(&out), &p))
}

fn generate(backend: &LlamaBackend, model: &LlamaModel, prompt: &str) -> Result<String, String> {
    let tokens = model.str_to_token(prompt, AddBos::Always).map_err(|e| e.to_string())?;
    let n_ctx = (tokens.len() + MAX_OUTPUT + 64) as u32;
    let batch_size = 2048;
    let params = LlamaContextParams::default()
        .with_n_ctx(NonZeroU32::new(n_ctx))
        .with_n_batch(batch_size as u32)
        .with_n_threads(threads())
        .with_n_threads_batch(threads());
    let mut ctx = model.new_context(backend, params).map_err(|e| format!("Not enough memory for the summary: {e}"))?;

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

    // Low temperature: summaries should stick to the transcript.
    let mut sampler = LlamaSampler::chain_simple([LlamaSampler::temp(0.3), LlamaSampler::top_p(0.9, 1), LlamaSampler::dist(42)]);
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut out = String::new();
    for _ in 0..MAX_OUTPUT {
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
        sampler.accept(token);
        if model.is_eog_token(token) {
            break;
        }
        out += &model.token_to_piece(token, &mut decoder, false, None).map_err(|e| e.to_string())?;
        batch.clear();
        batch.add(token, pos, &[0], true).map_err(|e| e.to_string())?;
        pos += 1;
        ctx.decode(&mut batch).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

/// Strip what small models sometimes wrap around the answer (code fences, preamble).
fn clean(out: &str) -> String {
    let s = out.trim().trim_start_matches("```markdown").trim_start_matches("```").trim_end_matches("```").trim();
    match s.find("## ") {
        Some(i) => s[i..].trim().to_string(),
        None => s.to_string(),
    }
}

/// Back to the note's words: "- Opnemer: …" becomes "- Ik: …"; a "Deelnemer:" the
/// model put in front anyway is dropped (it is not a name).
fn relabel(summary: &str, p: &Prompts) -> String {
    summary
        .lines()
        .map(|line| {
            let Some(rest) = line.strip_prefix("- ") else { return line.to_string() };
            let rest = rest.trim_start_matches("**");
            if let Some(task) = rest.strip_prefix(p.me).and_then(|r| r.trim_start_matches("**").strip_prefix(':')) {
                format!("- {}:{}", p.me_out, task.trim_start_matches("**"))
            } else if let Some(task) = rest.strip_prefix(p.others).and_then(|r| r.trim_start_matches("**").strip_prefix(':')) {
                let task = task.trim_start_matches("**").trim();
                let mut c = task.chars();
                format!("- {}", c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default())
            } else {
                line.to_string()
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Half the logical cores (2–8): the rest are efficiency cores or hyper-threads.
/// On an M4 (4 performance + 6 efficiency cores) speaker separation took 45–53 s
/// with 4 threads and 55–82 s with 8; recognition was the same either way.
fn threads() -> i32 {
    std::thread::available_parallelism().map(|n| (n.get() / 2).clamp(2, 8) as i32).unwrap_or(4)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: f32, end: f32, speaker: &str, text: &str) -> Segment {
        Segment { start, end, speaker: speaker.into(), speaker_id: None, text: text.into() }
    }

    #[test]
    fn merge_drops_echo_and_sorts() {
        let others = vec![seg(0.0, 4.0, "others", "Kun jij de begroting afronden?"), seg(10.0, 12.0, "others", "Top, tot dan")];
        let me = vec![
            seg(0.2, 4.1, "me", "kun jij de begroting afronden"), // echo of the speakers
            seg(5.0, 8.0, "me", "Ja, voor vrijdag"),
        ];
        let merged = merge(me, others, |_| 0.7);
        assert_eq!(merged.iter().map(|s| (s.speaker.as_str(), s.text.as_str())).collect::<Vec<_>>(), vec![
            ("others", "Kun jij de begroting afronden?"),
            ("me", "Ja, voor vrijdag"),
            ("others", "Top, tot dan"),
        ]);
    }

    #[test]
    fn echo_is_found_across_segment_boundaries() {
        // The mic heard the speakers; the tracks cut the sentence at different places.
        let others = vec![
            seg(137.0, 143.0, "others", "Oké, ja, zo meteen DTC stand up. En voor de rest ga ik aan het werk voor de"),
            seg(144.0, 156.0, "others", "presentatie van die documenten nog. Dus gisteren vooral nog andere pins opgepakt voor die fixes"),
        ];
        let me = vec![
            seg(140.0, 150.0, "me", "En voor de rest ga ik een keer voor de presentatie van die documenten nog"),
            seg(158.0, 160.0, "me", "Voor mij, Gasunie standup"), // after the others stopped: the user
            seg(156.5, 157.5, "me", "Ja, dat is goed voor de rest"), // common words they also used: still the user
            seg(141.0, 141.5, "me", "Ja"),                         // a short reply during their sentence: kept
            seg(146.0, 146.6, "me", "Oké."),                       // ...but an echo of their short "Oké." is not
        ];
        let others = [others, vec![seg(145.9, 146.5, "others", "Oké.")]].concat();
        let merged = merge(me, others, |_| 0.7);
        let mine: Vec<&str> = merged.iter().filter(|s| s.speaker == "me").map(|s| s.text.as_str()).collect();
        assert_eq!(mine, vec!["Ja", "Ja, dat is goed voor de rest", "Voor mij, Gasunie standup"]);
    }

    #[test]
    fn splits_joined_segments_by_token_time() {
        // From a real run: "Goedemorgen." | "Oké." | "Nee hoor." joined with 0.6 s gaps; times run a little early.
        let tokens: Vec<String> = ["Go", "ed", "em", "or", "gen", ".", " O", "ké", ".", " Ne", "e", " ho", "or", "."].map(String::from).to_vec();
        let ts = [0.0, 0.16, 0.24, 0.32, 0.48, 0.8, 1.04, 1.28, 1.52, 2.24, 2.4, 2.64, 2.8, 2.96];
        let offsets = [0, (1.246 * 16000.0) as usize, (2.428 * 16000.0) as usize];
        assert_eq!(split_by_time(&tokens, &ts, &offsets), vec!["Goedemorgen.", "Oké.", "Nee hoor."]);
    }

    #[test]
    fn echo_is_found_by_how_the_loudness_follows_the_system_audio() {
        let others = vec![seg(0.0, 3.0, "others", "Yeah, we share me for uh G as to us")];
        let me = vec![
            seg(0.3, 3.2, "me", "Yeah, share with uh Glost. I keep seeing seeds"), // misheard differently: text doesn't match
            seg(5.0, 8.0, "me", "Ja, ik ben gisteren flink aan de slag geweest"),
        ];
        let merged = merge(me, others, |m| if m.start < 1.0 { 0.9 } else { 0.12 });
        let mine: Vec<&str> = merged.iter().filter(|s| s.speaker == "me").map(|s| s.text.as_str()).collect();
        assert_eq!(mine, vec!["Ja, ik ben gisteren flink aan de slag geweest"]);

        // The envelope correlation itself: a delayed, quieter copy correlates; other speech doesn't.
        let sys: Vec<f32> = (0..4000).map(|i| ((i as f32 / 300.0).sin() * (i as f32 / 7.0).sin()) * 0.5).collect();
        let sys = [sys.clone(), sys.clone(), sys.clone(), sys].concat();
        let echo: Vec<f32> = std::iter::repeat_n(0.0, 1600).chain(sys.iter().map(|x| x * 0.2)).take(sys.len()).collect();
        let own: Vec<f32> = (0..sys.len()).map(|i| ((i as f32 / 900.0).cos() * (i as f32 / 5.0).sin()) * 0.3).collect();
        let m = seg(0.2, 0.9, "me", "x");
        assert!(echo_correlation(&m, &envelope(&echo), &envelope(&sys)) > 0.9);
        assert!(echo_correlation(&m, &envelope(&own), &envelope(&sys)) < 0.6);
    }

    #[test]
    fn segments_are_cut_where_the_speaker_changes() {
        let sr = SAMPLE_RATE as usize;
        let audio = vec![0.1f32; 6 * sr]; // 6 s of speech starting at 10 s
        let turns = [
            Turn { start: 9.5, end: 12.0, speaker: 7 },
            Turn { start: 12.0, end: 12.3, speaker: 3 }, // a 0.3 s blip: folded into its neighbour
            Turn { start: 12.3, end: 14.0, speaker: 7 },
            Turn { start: 14.2, end: 17.0, speaker: 4 }, // the gap 14.0–14.2 keeps the previous voice
        ];
        let pieces = split_at_speakers(10 * sr, &audio, &turns);
        let summary: Vec<(f32, f32, Option<u32>)> =
            pieces.iter().map(|(at, a, w)| (*at as f32 / sr as f32, (at + a.len()) as f32 / sr as f32, *w)).collect();
        assert_eq!(summary, vec![(10.0, 14.2, Some(7)), (14.2, 16.0, Some(4))]);
        assert_eq!(pieces.iter().map(|p| p.1.len()).sum::<usize>(), audio.len());
        // no turns at all: one piece, no voice
        assert_eq!(split_at_speakers(0, &audio, &[]).iter().map(|p| p.2).collect::<Vec<_>>(), vec![None]);
    }

    #[test]
    fn reads_segments_and_names_as_the_ui_sends_them() {
        let names: HashMap<u32, String> = serde_json::from_str(r#"{"2":"Jeroen"}"#).unwrap();
        assert_eq!(names.get(&2).map(String::as_str), Some("Jeroen"));
        let segs: Vec<Segment> = serde_json::from_str(
            r#"[{"start":0,"end":1,"speaker":"others","speakerId":2,"text":"a"},{"start":1,"end":2,"speaker":"me","speakerId":null,"text":"b"},{"start":2,"end":3,"speaker":"others","text":"c"}]"#,
        )
        .unwrap();
        assert_eq!(segs.iter().map(|s| s.speaker_id).collect::<Vec<_>>(), vec![Some(2), None, None]);
    }

    #[test]
    fn echo_stretches_are_cut_out_of_a_segment() {
        let sr = SAMPLE_RATE as usize;
        let audio = vec![0.1f32; 5 * sr]; // 5 s starting at 2 s
        let mut mask = vec![false; 400]; // 8 s of frames
        mask[150..250].iter_mut().for_each(|m| *m = true); // 3–5 s: echo
        mask[300..305].iter_mut().for_each(|m| *m = true); // a 0.1 s blip: ignored
        let pieces = cut_out(2 * sr, &audio, &mask);
        let spans: Vec<(f32, f32)> = pieces.iter().map(|(at, a)| (*at as f32 / sr as f32, (at + a.len()) as f32 / sr as f32)).collect();
        assert_eq!(spans, vec![(2.0, 3.0), (5.0, 7.0)]);
        // nothing masked: the segment as it was
        assert_eq!(cut_out(0, &audio, &[]).len(), 1);
    }

    #[test]
    fn speakers_are_numbered_by_first_appearance() {
        let mut segs = vec![
            Segment { speaker_id: Some(7), ..seg(0.0, 1.0, "others", "a") },
            seg(1.0, 2.0, "me", "b"),
            Segment { speaker_id: Some(2), ..seg(2.0, 3.0, "others", "c") },
            Segment { speaker_id: Some(7), ..seg(3.0, 4.0, "others", "d") },
        ];
        let order = number_speakers(&mut segs);
        assert_eq!(segs.iter().map(|s| s.speaker_id).collect::<Vec<_>>(), vec![Some(1), None, Some(2), Some(1)]);
        assert_eq!(order, HashMap::from([(7, 1), (2, 2)]));
    }

    #[test]
    fn known_voices_are_matched_once_each() {
        let unit = |v: [f32; 3]| normalize(v.to_vec());
        let known = vec![
            KnownVoice { name: "Jeroen".into(), print: unit([1.0, 0.0, 0.0]) },
            KnownVoice { name: "Patrick".into(), print: unit([0.0, 1.0, 0.0]) },
        ];
        let prints = HashMap::from([
            (1, unit([0.9, 0.3, 0.1])),  // clearly Jeroen
            (2, unit([0.8, 0.45, 0.2])), // also close to Jeroen, but 1 is closer: not Jeroen again
            (3, unit([0.0, 0.55, 0.85])), // a bit like Patrick: only a suggestion level match
            (4, unit([0.0, 0.0, 1.0])),  // nobody known
        ]);
        let m = match_voices(&prints, &known);
        assert_eq!(m.get(&1).map(|m| m.name.as_str()), Some("Jeroen"));
        assert!(m.get(&2).is_none_or(|m| m.name != "Jeroen"));
        let p = &m[&3];
        assert_eq!(p.name, "Patrick");
        assert!(p.similarity >= SUGGEST && p.similarity < RECOGNIZE, "{}", p.similarity);
        assert!(!m.contains_key(&4));
    }

    #[test]
    fn in_person_meetings_have_no_me() {
        let merged = merge(vec![seg(0.0, 2.0, "me", "Goedemorgen")], vec![], |_| 0.0);
        assert_eq!(merged[0].speaker, "unknown");
    }

    #[test]
    fn detects_dutch_and_english() {
        assert_eq!(detect_language(&[seg(0.0, 1.0, "me", "Ik denk dat het een goed plan is, maar we moeten nog wel testen")]), "nl");
        assert_eq!(detect_language(&[seg(0.0, 1.0, "me", "I think that this is a good plan, but we have to test it")]), "en");
    }

    #[test]
    fn cleans_model_output() {
        assert_eq!(clean("Sure! Here it is:\n```markdown\n## Samenvatting\nTekst\n```"), "## Samenvatting\nTekst");
    }

    #[test]
    fn formats_the_transcript_for_the_model() {
        let t = transcript_text(&[seg(65.0, 70.0, "me", "Hallo"), seg(70.0, 71.0, "others", "Hoi")], "nl", &HashMap::new());
        assert_eq!(t, "[01:05] Opnemer: Hallo\n[01:10] Deelnemer: Hoi\n");
        let numbered = [Segment { speaker_id: Some(1), ..seg(1.0, 2.0, "others", "A") }, Segment { speaker_id: Some(2), ..seg(3.0, 4.0, "others", "B") }];
        let names = HashMap::from([(2, "Jeroen".to_string())]);
        assert_eq!(transcript_text(&numbered, "nl", &names), "[00:01] Spreker 1: A\n[00:03] Jeroen: B\n");
    }

    #[test]
    fn summary_labels_become_the_notes_words() {
        let out = relabel("## Actiepunten\n- Opnemer: tickets afmaken\n- **Opnemer:** testen\n- Deelnemer: labels doorlopen\n- Germen: zoekpagina", &prompts("nl"));
        assert_eq!(out, "## Actiepunten\n- Ik: tickets afmaken\n- Ik: testen\n- Labels doorlopen\n- Germen: zoekpagina");
    }
}

/// Calibrating voice recognition: fingerprints of each speaker from the first
/// and the second half of a real meeting, compared with each other. Run with
/// `FORGOR_MODELS=… FORGOR_RECORDING=… cargo test --release --lib voice_calibration -- --ignored --nocapture`.
#[cfg(test)]
mod voice_calibration {
    use super::*;

    #[test]
    #[ignore]
    fn same_voice_vs_other_voices() {
        let (Ok(models), Ok(rec)) = (std::env::var("FORGOR_MODELS"), std::env::var("FORGOR_RECORDING")) else { return };
        let dir = Path::new(&models).join("speakers");
        let system = read_track(&Path::new(&rec).join(SYSTEM_FILE)).unwrap();
        let turns = diarize(&system, &dir).unwrap();
        let half = system.len() as f32 / SAMPLE_RATE as f32 / 2.0;
        let a = voice_prints(&system, &turns.iter().copied().filter(|t| t.end <= half).collect::<Vec<_>>(), &dir).unwrap();
        let b = voice_prints(&system, &turns.iter().copied().filter(|t| t.start >= half).collect::<Vec<_>>(), &dir).unwrap();
        let mut same = vec![];
        let mut other = vec![];
        for (sa, ea) in &a {
            for (sb, eb) in &b {
                let s = similarity_of(ea, eb);
                println!("first-half {sa} vs second-half {sb}: {s:.2}");
                if sa == sb { same.push(s) } else { other.push(s) }
            }
        }
        same.sort_by(f32::total_cmp);
        other.sort_by(f32::total_cmp);
        println!("same voice: {same:.2?}\nother voices: {other:.2?}");
    }
}

/// Summary quality: `FORGOR_SEGMENTS=<json {language, names, segments}> FORGOR_SUMMARY_MODEL=<gguf>
/// cargo test --release --lib summary_eval -- --ignored --nocapture`.
#[cfg(test)]
mod summary_eval {
    use super::*;

    #[derive(Deserialize)]
    struct Case {
        language: String,
        names: HashMap<u32, String>,
        segments: Vec<Segment>,
    }

    #[test]
    #[ignore]
    fn summarize_a_case() {
        let (Ok(case), Ok(model)) = (std::env::var("FORGOR_SEGMENTS"), std::env::var("FORGOR_SUMMARY_MODEL")) else { return };
        let case: Case = serde_json::from_str(&std::fs::read_to_string(case).unwrap()).unwrap();
        let t = std::time::Instant::now();
        let lang = if case.language == "en" { "en" } else { "nl" };
        let out = summarize(&case.segments, lang, &case.names, Path::new(&model), &|_, _| {}).unwrap();
        println!("{out}\n--- {:.1}s", t.elapsed().as_secs_f32());
    }
}

/// End to end with the real models. Run with
/// `FORGOR_MODELS=<dir with speech/ and summary/> FORGOR_RECORDING=<dir with mic.wav/system.wav> cargo test --release -- --ignored --nocapture`.
#[cfg(test)]
mod real_models {
    use super::*;

    #[test]
    #[ignore]
    fn transcribes_and_summarizes() {
        let (Ok(models), Ok(rec)) = (std::env::var("FORGOR_MODELS"), std::env::var("FORGOR_RECORDING")) else { return };
        let models = Path::new(&models);
        let t = std::time::Instant::now();
        let speakers = models.join("speakers");
        let segments = transcribe(Path::new(&rec), &models.join("speech"), speakers.exists().then_some(speakers.as_path()), &|_, _| {}).unwrap().segments;
        let lang = detect_language(&segments);
        println!("{}--- {lang}, transcribed in {:.1}s", transcript_text(&segments, lang, &HashMap::new()), t.elapsed().as_secs_f32());
        if std::env::var("FORGOR_SKIP_SUMMARY").is_ok() {
            return;
        }
        let t = std::time::Instant::now();
        let summary = summarize(&segments, lang, &HashMap::new(), &models.join("summary/gemma-4-E4B-it-Q4_0.gguf"), &|_, _| {}).unwrap();
        println!("{summary}\n--- summarized in {:.1}s", t.elapsed().as_secs_f32());
        assert!(summary.starts_with("## "));
    }
}
