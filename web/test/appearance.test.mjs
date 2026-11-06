import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../src/lib/appearanceModel.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
});
const model = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputText).toString("base64")}`);

test("clarity is clamped to 0..1 in hundredths", () => {
  assert.equal(model.clampClarity(-1), 0);
  assert.equal(model.clampClarity(2), 1);
  assert.equal(model.clampClarity(0.333333), 0.33);
  assert.equal(model.clampClarity("0.5"), 0.5);
  assert.equal(model.clampClarity(Number.NaN), model.DEFAULT_APPEARANCE.clarity);
});

test("normalizeAppearance repairs partial or hostile storage", () => {
  assert.deepEqual(model.normalizeAppearance(null), model.DEFAULT_APPEARANCE);
  assert.deepEqual(model.normalizeAppearance({ clarity: 0.8, motion: "warp", dynamicHighlight: "yes" }), {
    ...model.DEFAULT_APPEARANCE,
    clarity: 0.8,
  });
  assert.deepEqual(model.parseStoredAppearance("{not json"), model.DEFAULT_APPEARANCE);
  assert.equal(model.parseStoredAppearance(JSON.stringify({ clarity: 0 })).clarity, 0);
});

test("motion preference resolves against the OS setting", () => {
  assert.equal(model.resolveMotion("system", true), "reduced");
  assert.equal(model.resolveMotion("system", false), "full");
  assert.equal(model.resolveMotion("off", false), "off");
  assert.equal(model.resolveMotion("full", true), "full");
});

test("attributes match what the pre-paint script writes", () => {
  assert.deepEqual(model.appearanceAttributes({ clarity: 1.4, motion: "reduced", dynamicHighlight: false, increaseContrast: true, boldText: true, wallpaper: "vivid", refraction: false }, false), {
    clarity: "1",
    motion: "reduced",
    highlight: "static",
    contrast: "high",
    bold: "on",
    wallpaper: "vivid",
    refraction: "off",
  });
  assert.equal(model.appearanceAttributes(model.DEFAULT_APPEARANCE, false).wallpaper, "soft");
  assert.equal(model.normalizeAppearance({ wallpaper: "neon" }).wallpaper, "soft");
  assert.equal(model.appearanceAttributes(model.DEFAULT_APPEARANCE, false).bold, "off");
});

test("clarity labels cover the whole slider", () => {
  assert.equal(model.clarityLabel(0), "超透明");
  assert.equal(model.clarityLabel(0.35), "透明");
  assert.equal(model.clarityLabel(0.7), "磨砂");
  assert.equal(model.clarityLabel(1), "着色");
});
