import { describe, expect, it } from "vitest";
import { meterWidth, recordingWarnings } from "./recording";

const ok = { mic: 0.05, system: 0.02, micSignal: true, systemAudio: true, elapsedSec: 30, silentSec: 2 };

describe("recording status", () => {
  it("is quiet when all is well", () => {
    expect(recordingWarnings(ok)).toEqual([]);
  });

  it("warns about a mic without signal, after a few seconds", () => {
    expect(recordingWarnings({ ...ok, micSignal: false, elapsedSec: 2 })).toEqual([]);
    expect(recordingWarnings({ ...ok, micSignal: false, elapsedSec: 5 })[0].text).toMatch(/No sound from your microphone/);
  });

  it("says when only the mic is recorded, and after 10 minutes of silence", () => {
    expect(recordingWarnings({ ...ok, systemAudio: false })[0].text).toMatch(/Only your microphone/);
    expect(recordingWarnings({ ...ok, silentSec: 599 })).toEqual([]);
    expect(recordingWarnings({ ...ok, silentSec: 660 })[0].text).toMatch(/Nothing heard for 11 minutes/);
  });

  it("maps loudness to the meter in dB", () => {
    expect(meterWidth(0)).toBe(0);
    expect(meterWidth(1)).toBeCloseTo(100);
    expect(meterWidth(0.001)).toBeLessThan(0.1); // -60 dB
    expect(meterWidth(0.0316)).toBeCloseTo(50, 0); // -30 dB
  });
});
