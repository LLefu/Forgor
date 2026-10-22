//! Notification sounds, made here (a few sine tones with a bell-like fade)
//! instead of shipped as files, and played on the default output device.
//! Forgor plays them itself because macOS stays silent for a notification
//! unless its own settings and the sound name line up, and this way it sounds
//! the same everywhere (also while the window is hidden in the tray).

use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    },
    time::Duration,
};

/// One tone: start (s), frequency (Hz), length (s), loudness 0–1.
type Note = (f32, f32, f32, f32);

fn notes(name: &str) -> Option<&'static [Note]> {
    Some(match name {
        // Two soft rising notes (G4, C5). Higher ones (A5/E6, G6) were far too shrill.
        "chime" => &[(0.0, 392.0, 0.45, 0.85), (0.13, 523.25, 0.6, 0.75)],
        // One round note (E5).
        "ping" => &[(0.0, 659.25, 0.5, 0.85)],
        // A short, soft low knock (E4 then C4).
        "pop" => &[(0.0, 329.63, 0.12, 0.95), (0.05, 261.63, 0.16, 0.7)],
        _ => return None,
    })
}

const VOLUME: f32 = 0.22;

/// The sound as mono samples at `rate`.
fn render(notes: &[Note], rate: u32) -> Vec<f32> {
    let length = notes.iter().map(|(start, _, len, _)| start + len).fold(0.0, f32::max) + 0.05;
    let mut out = vec![0.0f32; (length * rate as f32) as usize];
    for &(start, freq, len, gain) in notes {
        let first = (start * rate as f32) as usize;
        let count = (len * rate as f32) as usize;
        for i in 0..count {
            let t = i as f32 / rate as f32;
            // Quick attack, exponential fade (a bell), and a little of the octave above.
            let attack = (t / 0.005).min(1.0);
            let fade = (-t * 6.0 / len).exp();
            let wave = (2.0 * std::f32::consts::PI * freq * t).sin() + 0.12 * (4.0 * std::f32::consts::PI * freq * t).sin();
            if let Some(s) = out.get_mut(first + i) {
                *s += wave * attack * fade * gain * VOLUME;
            }
        }
    }
    for s in &mut out {
        *s = s.clamp(-1.0, 1.0);
    }
    out
}

/// Plays a notification sound ("chime", "ping", "pop") without waiting for it.
#[tauri::command]
pub fn play_sound(name: String) -> Result<(), String> {
    let notes = notes(&name).ok_or_else(|| format!("Unknown sound: {name}"))?;
    let device = cpal::default_host().default_output_device().ok_or("No audio output device")?;
    let config = device.default_output_config().map_err(|e| e.to_string())?;
    let channels = config.channels() as usize;
    let samples = Arc::new(render(notes, config.sample_rate()));
    let duration = Duration::from_secs_f32(samples.len() as f32 / config.sample_rate() as f32 + 0.15);
    let format = config.sample_format();
    let stream_config: cpal::StreamConfig = config.into();
    // The stream has to live until the sound is over; a thread keeps it (cpal streams aren't Send on every OS, so it's built there).
    std::thread::spawn(move || {
        let pos = Arc::new(AtomicUsize::new(0));
        let next = {
            let (samples, pos) = (samples.clone(), pos.clone());
            move || samples.get(pos.fetch_add(1, Ordering::Relaxed)).copied().unwrap_or(0.0)
        };
        let err = |e: cpal::Error| eprintln!("sound error: {e}");
        let stream = match format {
            cpal::SampleFormat::F32 => device.build_output_stream(
                stream_config,
                move |data: &mut [f32], _: &cpal::OutputCallbackInfo| {
                    for frame in data.chunks_mut(channels) {
                        frame.fill(next());
                    }
                },
                err,
                None,
            ),
            cpal::SampleFormat::I16 => device.build_output_stream(
                stream_config,
                move |data: &mut [i16], _: &cpal::OutputCallbackInfo| {
                    for frame in data.chunks_mut(channels) {
                        frame.fill((next() * i16::MAX as f32) as i16);
                    }
                },
                err,
                None,
            ),
            other => {
                eprintln!("sound: unsupported sample format {other:?}");
                return;
            }
        };
        match stream {
            Ok(stream) => {
                if stream.play().is_ok() {
                    std::thread::sleep(duration);
                }
            }
            Err(e) => eprintln!("sound: {e}"),
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sounds_are_short_quiet_and_fade_out() {
        for name in ["chime", "ping", "pop"] {
            let s = render(notes(name).unwrap(), 48_000);
            assert!(s.len() < 48_000, "{name} is under a second");
            assert!(s.iter().all(|x| x.abs() <= VOLUME * 1.6), "{name} stays quiet");
            assert!(s[s.len() - 100..].iter().all(|x| x.abs() < 0.01), "{name} ends in silence");
        }
        assert!(notes("siren").is_none());
    }
}
