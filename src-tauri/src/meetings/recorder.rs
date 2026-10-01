//! Records the microphone ("me") and the system output ("others", loopback)
//! to two 16 kHz mono WAV files. cpal does the loopback: WASAPI on Windows,
//! a Core Audio process tap on macOS 14.6+.
//!
//! Audio callbacks only hand samples to a writer thread; the writer resamples,
//! writes and flushes the WAV header every few seconds, so a crash or power
//! loss leaves a playable file behind.

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering},
        mpsc, Arc,
    },
    thread,
    time::{Duration, Instant},
};

pub const SAMPLE_RATE: u32 = 16_000;
pub const MIC_FILE: &str = "mic.wav";
pub const SYSTEM_FILE: &str = "system.wav";

/// Live loudness of one track while recording (written by its writer thread).
#[derive(Default)]
pub struct Level {
    /// RMS of the latest audio, as f32 bits.
    rms: AtomicU32,
    /// When audio last arrived / last had sound (ms since the recording started; 0 = never).
    updated_ms: AtomicU64,
    heard_ms: AtomicU64,
    /// Any non-zero sample at all. A mic without permission delivers exact zeros.
    signal: AtomicBool,
}

/// Louder than this counts as sound (about -48 dBFS): speech, not room noise.
const SOUND: f32 = 0.004;

impl Level {
    fn update(&self, samples: &[f32], now_ms: u64) {
        if samples.is_empty() {
            return;
        }
        let rms = (samples.iter().map(|x| x * x).sum::<f32>() / samples.len() as f32).sqrt();
        self.rms.store(rms.to_bits(), Ordering::Relaxed);
        self.updated_ms.store(now_ms.max(1), Ordering::Relaxed);
        if rms > SOUND {
            self.heard_ms.store(now_ms.max(1), Ordering::Relaxed);
        }
        if !self.signal.load(Ordering::Relaxed) && samples.iter().any(|&x| x != 0.0) {
            self.signal.store(true, Ordering::Relaxed);
        }
    }

    /// (current level 0..1, any signal yet, ms since the start when sound was last heard).
    /// macOS sends no system audio at all while nothing plays: stale means silent.
    pub fn read(&self, now_ms: u64) -> (f32, bool, u64) {
        let fresh = now_ms.saturating_sub(self.updated_ms.load(Ordering::Relaxed)) < 400;
        let rms = if fresh { f32::from_bits(self.rms.load(Ordering::Relaxed)) } else { 0.0 };
        (rms, self.signal.load(Ordering::Relaxed), self.heard_ms.load(Ordering::Relaxed))
    }
}

/// A running recording. Dropping it without `stop` also stops it.
pub struct Recorder {
    stop: Option<mpsc::Sender<()>>,
    thread: Option<thread::JoinHandle<Result<(), String>>>,
    pub system_audio: bool,
    pub mic_level: Arc<Level>,
    pub system_level: Arc<Level>,
    pub started: Instant,
}

impl Recorder {
    /// Start recording into `dir`. `mic` is a device name (None = system default).
    pub fn start(dir: &Path, mic: Option<String>) -> Result<Recorder, String> {
        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        let dir = dir.to_path_buf();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let (ready_tx, ready_rx) = mpsc::channel::<Result<bool, String>>();
        let (mic_level, system_level) = (Arc::new(Level::default()), Arc::new(Level::default()));
        let started = Instant::now();
        let levels = (mic_level.clone(), system_level.clone());
        // cpal streams are not Send on every platform: create, own and drop them on one thread.
        let thread = thread::spawn(move || run(dir, mic, levels, started, stop_rx, ready_tx));
        match ready_rx.recv_timeout(Duration::from_secs(15)) {
            Ok(Ok(system_audio)) => Ok(Recorder { stop: Some(stop_tx), thread: Some(thread), system_audio, mic_level, system_level, started }),
            Ok(Err(e)) => {
                let _ = thread.join();
                Err(e)
            }
            Err(_) => Err("The audio devices did not respond".into()),
        }
    }

    pub fn stop(mut self) -> Result<(), String> {
        self.finish()
    }

    fn finish(&mut self) -> Result<(), String> {
        if let Some(stop) = self.stop.take() {
            let _ = stop.send(());
        }
        match self.thread.take() {
            Some(t) => t.join().map_err(|_| "The recorder crashed".to_string())?,
            None => Ok(()),
        }
    }
}

impl Drop for Recorder {
    fn drop(&mut self) {
        let _ = self.finish();
    }
}

fn run(
    dir: PathBuf,
    mic: Option<String>,
    (mic_level, system_level): (Arc<Level>, Arc<Level>),
    started: Instant,
    stop: mpsc::Receiver<()>,
    ready: mpsc::Sender<Result<bool, String>>,
) -> Result<(), String> {
    let host = cpal::default_host();

    let mic_device = match &mic {
        Some(name) => host
            .input_devices()
            .map_err(|e| e.to_string())?
            .find(|d| device_name(d).as_deref() == Some(name.as_str()))
            .or_else(|| host.default_input_device()),
        None => host.default_input_device(),
    };
    let Some(mic_device) = mic_device else {
        let _ = ready.send(Err("No microphone found".into()));
        return Ok(());
    };

    let mic_track = match Track::open(&mic_device, &dir.join(MIC_FILE), started, mic_level) {
        Ok(t) => t,
        Err(e) => {
            let _ = ready.send(Err(format!("Could not open the microphone: {e}")));
            return Ok(());
        }
    };
    // System audio is best effort: older macOS versions have no loopback. The
    // recording then only has the microphone.
    let system_track = host
        .default_output_device()
        .ok_or_else(|| "no output device".to_string())
        .and_then(|d| Track::open(&d, &dir.join(SYSTEM_FILE), started, system_level));
    if let Err(e) = &system_track {
        eprintln!("system audio unavailable: {e}");
    }
    let _ = ready.send(Ok(system_track.is_ok()));

    let _ = stop.recv(); // until stopped (or the Recorder is dropped)
    mic_track.close()?;
    if let Ok(t) = system_track {
        t.close()?;
    }
    Ok(())
}

pub fn device_name(d: &cpal::Device) -> Option<String> {
    d.description().ok().map(|d| d.name().to_string())
}

pub fn input_device_names() -> Vec<String> {
    let host = cpal::default_host();
    host.input_devices().map(|ds| ds.filter_map(|d| device_name(&d)).collect()).unwrap_or_default()
}

/// One capture stream plus the thread that writes it to disk.
struct Track {
    stream: cpal::Stream,
    writer: thread::JoinHandle<Result<(), String>>,
}

impl Track {
    fn open(device: &cpal::Device, path: &Path, started: Instant, level: Arc<Level>) -> Result<Track, String> {
        // Input devices have an input config; for loopback we record the output device's format.
        let config = device.default_input_config().or_else(|_| device.default_output_config()).map_err(|e| e.to_string())?;
        let channels = config.channels() as usize;
        let rate = config.sample_rate();
        let (tx, rx) = mpsc::channel::<Vec<f32>>();
        let err = |e: cpal::Error| eprintln!("audio stream error: {e}");
        let stream_config: cpal::StreamConfig = config.clone().into();
        // Downmix to mono in the callback (cheap); everything else happens on the writer thread.
        let stream = match config.sample_format() {
            cpal::SampleFormat::F32 => device.build_input_stream(
                stream_config,
                move |data: &[f32], _: &cpal::InputCallbackInfo| {
                    let _ = tx.send(data.chunks(channels).map(|f| f.iter().sum::<f32>() / channels as f32).collect());
                },
                err,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_input_stream(
                stream_config,
                move |data: &[i16], _: &cpal::InputCallbackInfo| {
                    let _ = tx.send(data.chunks(channels).map(|f| f.iter().map(|&s| s as f32 / 32768.0).sum::<f32>() / channels as f32).collect());
                },
                err,
                None,
            ),
            other => return Err(format!("unsupported sample format {other:?}")),
        }
        .map_err(|e| e.to_string())?;
        stream.play().map_err(|e| e.to_string())?;

        let spec = hound::WavSpec { channels: 1, sample_rate: SAMPLE_RATE, bits_per_sample: 16, sample_format: hound::SampleFormat::Int };
        let mut wav = hound::WavWriter::create(path, spec).map_err(|e| e.to_string())?;
        // Dev builds also keep the device's original audio (e.g. 48 kHz), to check
        // what the conversion to 16 kHz costs while tuning recognition.
        let mut raw = if cfg!(debug_assertions) {
            let spec = hound::WavSpec { sample_rate: rate, ..spec };
            Some(hound::WavWriter::create(path.with_extension("raw.wav"), spec).map_err(|e| e.to_string())?)
        } else {
            None
        };
        let writer = thread::spawn(move || -> Result<(), String> {
            let mut resampler = Resampler::new(rate);
            let mut last_flush = Instant::now();
            let mut written: u64 = 0;
            let mut raw_written: u64 = 0;
            let silence = |wav: &mut hound::WavWriter<_>, n: u64| -> Result<u64, String> {
                for _ in 0..n {
                    wav.write_sample(0i16).map_err(|e| e.to_string())?;
                }
                Ok(n)
            };
            for chunk in rx {
                level.update(&chunk, started.elapsed().as_millis() as u64);
                let samples = resampler.push(&chunk);
                // macOS delivers nothing at all while no sound plays (and streams start a
                // little apart): fill those gaps with silence, so both tracks keep one timeline.
                written += silence(&mut wav, gap_to_fill(written, samples.len() as u64, started.elapsed().as_secs_f64()))?;
                for s in &samples {
                    wav.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).map_err(|e| e.to_string())?;
                }
                written += samples.len() as u64;
                if let Some(raw) = raw.as_mut() {
                    let elapsed = started.elapsed().as_secs_f64();
                    raw_written += silence(raw, gap_at(raw_written, chunk.len() as u64, elapsed, rate))?;
                    for s in &chunk {
                        raw.write_sample((s.clamp(-1.0, 1.0) * 32767.0) as i16).map_err(|e| e.to_string())?;
                    }
                    raw_written += chunk.len() as u64;
                }
                if last_flush.elapsed() > Duration::from_secs(5) {
                    wav.flush().map_err(|e| e.to_string())?; // also updates the header
                    if let Some(raw) = raw.as_mut() {
                        raw.flush().map_err(|e| e.to_string())?;
                    }
                    last_flush = Instant::now();
                }
            }
            if let Some(raw) = raw {
                raw.finalize().map_err(|e| e.to_string())?;
            }
            // Up to the moment recording stopped (a quiet end delivers nothing either).
            silence(&mut wav, gap_to_fill(written, 0, started.elapsed().as_secs_f64()))?;
            wav.finalize().map_err(|e| e.to_string())
        });
        Ok(Track { stream, writer })
    }

    fn close(self) -> Result<(), String> {
        drop(self.stream); // closes the channel, so the writer finishes
        self.writer.join().map_err(|_| "The audio writer crashed".to_string())?
    }
}

/// Silence to insert before `incoming` new samples so the track catches up with
/// the clock (`elapsed` seconds since the recording started). Small delays are
/// normal buffering and left alone.
fn gap_to_fill(written: u64, incoming: u64, elapsed: f64) -> u64 {
    gap_at(written, incoming, elapsed, SAMPLE_RATE)
}

fn gap_at(written: u64, incoming: u64, elapsed: f64, rate: u32) -> u64 {
    let expected = (elapsed * rate as f64) as u64;
    let behind = expected.saturating_sub(written + incoming);
    if behind > rate as u64 / 4 {
        behind
    } else {
        0
    }
}

/// Resamples to 16 kHz: averages the input samples that fall into each output
/// sample (a box low-pass, enough for speech) and carries fractions across chunks.
struct Resampler {
    step: f64,
    pos: f64,
    acc: f32,
    n: u32,
}

impl Resampler {
    fn new(input_rate: u32) -> Self {
        Resampler { step: SAMPLE_RATE as f64 / input_rate as f64, pos: 0.0, acc: 0.0, n: 0 }
    }

    fn push(&mut self, input: &[f32]) -> Vec<f32> {
        let mut out = Vec::with_capacity((input.len() as f64 * self.step) as usize + 1);
        for &s in input {
            self.acc += s;
            self.n += 1;
            self.pos += self.step;
            if self.pos >= 1.0 {
                self.pos -= 1.0;
                out.push(self.acc / self.n as f32);
                self.acc = 0.0;
                self.n = 0;
            }
        }
        out
    }
}

/// Read a recorded track as f32 samples at 16 kHz (empty when the file is missing).
pub fn read_track(path: &Path) -> Result<Vec<f32>, String> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let mut reader = hound::WavReader::open(path).map_err(|e| format!("{}: {e}", path.display()))?;
    // A crash can leave a header that undercounts; read what is there.
    Ok(reader.samples::<i16>().filter_map(Result::ok).map(|s| s as f32 / 32768.0).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn levels_tell_silence_from_no_signal() {
        let l = Level::default();
        assert_eq!(l.read(100), (0.0, false, 0)); // nothing yet
        l.update(&[0.0; 480], 100); // a mic without permission: exact zeros
        assert_eq!(l.read(150), (0.0, false, 0));
        l.update(&[0.0005; 480], 200); // room noise: a signal, but not sound
        let (_, signal, heard) = l.read(250);
        assert!(signal && heard == 0);
        l.update(&[0.1; 480], 300); // speech
        let (rms, _, heard) = l.read(350);
        assert!((rms - 0.1).abs() < 1e-4 && heard == 300);
        assert_eq!(l.read(1_000).0, 0.0); // no audio arriving (macOS system audio while silent): level 0
    }

    #[test]
    fn gaps_are_filled_with_silence() {
        assert_eq!(gap_to_fill(0, 512, 0.03), 0); // normal start
        assert_eq!(gap_to_fill(0, 160, 3.0), 48_000 - 160); // first sound after 3 s
        assert_eq!(gap_to_fill(16_000, 160, 1.05), 0); // a little behind: buffering
        assert_eq!(gap_to_fill(16_000, 160, 11.0), 176_000 - 16_160); // 10 s without sound
        assert_eq!(gap_to_fill(160_000, 0, 10.0), 0);
    }

    #[test]
    fn resampler_keeps_duration_and_level() {
        let mut r = Resampler::new(48_000);
        let mut out = Vec::new();
        for _ in 0..10 {
            out.extend(r.push(&vec![0.5; 4_800])); // 1 s in 10 chunks
        }
        assert_eq!(out.len(), 16_000);
        assert!(out.iter().all(|s| (s - 0.5).abs() < 1e-6));

        let mut r = Resampler::new(44_100);
        let n: usize = (0..10).map(|_| r.push(&vec![0.0; 4_410]).len()).sum();
        assert!((15_999..=16_001).contains(&n), "{n}");
    }
}

/// Records from the real devices. Run with
/// `FORGOR_RECORD_TO=<empty dir> cargo test --release recorder::real_devices -- --ignored --nocapture`
/// while something plays audio.
#[cfg(test)]
mod real_devices {
    use super::*;

    #[test]
    #[ignore]
    fn records_mic_and_system_audio() {
        let Ok(dir) = std::env::var("FORGOR_RECORD_TO") else { return };
        let secs: u64 = std::env::var("FORGOR_RECORD_SECS").ok().and_then(|s| s.parse().ok()).unwrap_or(10);
        let dir = PathBuf::from(dir);
        let rec = Recorder::start(&dir, None).unwrap();
        println!("system audio: {}", rec.system_audio);
        thread::sleep(Duration::from_secs(secs));
        rec.stop().unwrap();
        for f in [MIC_FILE, SYSTEM_FILE] {
            let s = read_track(&dir.join(f)).unwrap();
            let peak = s.iter().fold(0f32, |m, x| m.max(x.abs()));
            println!("{f}: {:.2}s, peak {peak:.3}", s.len() as f32 / SAMPLE_RATE as f32);
        }
    }
}
