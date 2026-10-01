import { beforeEach, describe, expect, it } from "vitest";
import { MemoryVault, SqlJsDriver } from "@/platform/memory";
import { setCtx } from "./context";
import { migrate } from "./schema";
import { forgetVoice, knownVoices, learnVoices, listVoices } from "./voices";

beforeEach(async () => {
  const sql = await SqlJsDriver.create();
  setCtx({ sql, vault: new MemoryVault() });
  await migrate(sql);
});

describe("known voices", () => {
  it("are learned per meeting and averaged per person", async () => {
    await learnVoices("m1", { 1: "Jeroen", 2: "Patrick" }, { 1: [1, 0], 2: [0, 1] });
    await learnVoices("m2", { 3: "Jeroen" }, { 3: [0.6, 0.8] });
    const jeroen = (await knownVoices()).find((v) => v.name === "Jeroen")!;
    // average of [1,0] and [0.6,0.8], back to unit length
    expect(jeroen.print[0]).toBeCloseTo(1.6 / Math.hypot(1.6, 0.8));
    expect(Math.hypot(...jeroen.print)).toBeCloseTo(1);
    expect((await listVoices()).map((v) => [v.name, v.meetings])).toEqual([["Jeroen", 2], ["Patrick", 1]]);
  });

  it("a correction replaces what that meeting taught", async () => {
    await learnVoices("m1", { 1: "Jeroen" }, { 1: [1, 0] });
    await learnVoices("m1", { 1: "Patrick" }, { 1: [1, 0] }); // it was Patrick after all
    expect((await listVoices()).map((v) => v.name)).toEqual(["Patrick"]);
  });

  it("speakers without a fingerprint or name are skipped, and voices can be forgotten", async () => {
    await learnVoices("m1", { 1: "Jeroen", 2: "", 3: "Germen" }, { 1: [1, 0], 2: [0, 1] });
    expect((await listVoices()).map((v) => v.name)).toEqual(["Jeroen"]);
    await forgetVoice("Jeroen");
    expect(await knownVoices()).toEqual([]);
  });
});
