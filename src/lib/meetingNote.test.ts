import { describe, expect, it } from "vitest";
import { composeMeetingBody, defaultMeetingTitle, fillMeetingNote, formatDuration, formatTimestamp, groupSegments, PROCESSING_PLACEHOLDER, renameInSummary, speakerLabel, speakersOf } from "./meetingNote";
import type { ProcessResult, Segment } from "@/platform/meetings";

const at = new Date(2026, 8, 30, 14, 5).getTime();
const seg = (start: number, end: number, speaker: Segment["speaker"], text: string): Segment => ({ start, end, speaker, text });

describe("meeting notes", () => {
  it("has a simple default title", () => {
    expect(defaultMeetingTitle(at)).toBe("Meeting 30 Sep 14.05");
  });

  it("formats times", () => {
    expect(formatTimestamp(65.4)).toBe("01:05");
    expect(formatTimestamp(3725)).toBe("1:02:05");
    expect(formatDuration(42)).toBe("42 s");
    expect(formatDuration(42 * 60)).toBe("42 min");
    expect(formatDuration(95 * 60)).toBe("1 h 35 min");
  });

  it("joins consecutive segments of one speaker", () => {
    const grouped = groupSegments([seg(0, 2, "me", "Hallo"), seg(2.5, 4, "me", "allemaal"), seg(5, 6, "others", "Hoi"), seg(20, 21, "others", "Later")]);
    expect(grouped.map((s) => s.text)).toEqual(["Hallo allemaal", "Hoi", "Later"]);
  });

  it("composes summary + transcript in the meeting's language", () => {
    const result: ProcessResult = {
      language: "nl",
      segments: [seg(0, 3, "others", "Zullen we beginnen?"), seg(4, 6, "me", "Ja, *prima*")],
      summary: "## Samenvatting\nKort overleg.",
      summaryError: null,
    };
    expect(composeMeetingBody(result, at, 125)).toBe(
      "_Opgenomen op 30 september 2026 om 14:05 · 2 min_\n\n## Samenvatting\nKort overleg.\n\n## Transcript\n\n**[00:00] Anderen:** Zullen we beginnen?\n\n**[00:04] Ik:** Ja, \\*prima\\*\n",
    );
    const en = composeMeetingBody({ language: "en", segments: [seg(0, 1, "unknown", "Hi")], summary: null, summaryError: "The summary model isn't downloaded" }, at, 30);
    expect(en).toContain("_No summary: The summary model isn't downloaded._");
    expect(en).toContain("**[00:00]:** Hi"); // in-person: no speaker label
  });

  it("says when there was no speech", () => {
    expect(composeMeetingBody({ language: "en", segments: [], summary: null, summaryError: null }, at, 10)).toContain("No speech was found");
  });

  it("keeps what the user typed while processing", () => {
    expect(fillMeetingNote(PROCESSING_PLACEHOLDER, "GEN")).toBe("GEN");
    expect(fillMeetingNote(`Agenda: budget\n\n${PROCESSING_PLACEHOLDER}`, "GEN")).toBe("Agenda: budget\n\nGEN");
  });

  it("transcribing again replaces the generated part only", () => {
    const first = composeMeetingBody({ language: "nl", segments: [seg(0, 1, "me", "Oud")], summary: null, summaryError: null }, at, 60);
    expect(fillMeetingNote(`Agenda: budget\n\n${first}`, "NEW")).toBe("Agenda: budget\n\nNEW");
    // after the editor saved it with * instead of _
    expect(fillMeetingNote(first.replace(/^_(.*)_$/m, "*$1*"), "NEW")).toBe("NEW");
  });

  it("labels separated speakers, with the names the user gave them", () => {
    const one = { ...seg(0, 2, "others", "Wie is er nog niet geweest?"), speakerId: 1 };
    const two = { ...seg(3, 6, "others", "Ik ben bezig met de zoekpagina."), speakerId: 2 };
    const three = { ...seg(7, 9, "others", "En ik met de labels."), speakerId: 3 };
    expect(speakerLabel(one, "nl")).toBe("Spreker 1");
    expect(speakerLabel(one, "en", { 1: "Emma" })).toBe("Emma");
    expect(speakerLabel(seg(0, 1, "others", "x"), "nl")).toBe("Anderen"); // without separation

    const result: ProcessResult = { language: "nl", segments: [one, two, three, seg(10, 11, "me", "Top")], summary: null, summaryError: null };
    // Spreker 2 and 3 turn out to be one person (the separation split them): same name, one paragraph
    const body = composeMeetingBody(result, at, 60, { 2: "Germen", 3: "Germen" });
    expect(body).toContain("**[00:00] Spreker 1:** Wie is er nog niet geweest?");
    expect(body).toContain("**[00:03] Germen:** Ik ben bezig met de zoekpagina. En ik met de labels.");
    expect(body).toContain("**[00:10] Ik:** Top");
  });

  it("lists the voices with quotes to recognize them", () => {
    const segs = [
      { ...seg(0, 2, "others", "Kort"), speakerId: 2 },
      { ...seg(2, 10, "others", "Een veel langere zin over de planning van vrijdag"), speakerId: 2 },
      { ...seg(10, 12, "others", "Hoi"), speakerId: 1 },
      seg(12, 13, "me", "Ik"),
    ];
    expect(speakersOf(segs)).toEqual([
      { id: 1, seconds: 2, quotes: ["Hoi"] },
      { id: 2, seconds: 10, quotes: ["Een veel langere zin over de planning van vrijdag", "Kort"] },
    ]);
  });

  it("puts names in an existing summary when it can't be made again", () => {
    expect(renameInSummary("- Spreker 2: tickets\n- Spreker 12: labels\n- Spreker 3: x", { 2: "Jeroen", 12: "Patrick" })).toBe("- Jeroen: tickets\n- Patrick: labels\n- Spreker 3: x");
  });
});
