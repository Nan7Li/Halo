import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(new URL("../public/theme-init.js", import.meta.url), "utf8");

function initializeTheme(storedTheme, systemDark, { appearance = null, systemReduced = false } = {}) {
  const classes = new Set();
  const styles = new Map();
  const attributes = new Map();
  const root = {
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      },
    },
    setAttribute(name, value) {
      attributes.set(name, value);
    },
    style: {
      background: "",
      setProperty(name, value) {
        styles.set(name, value);
      },
    },
  };
  vm.runInNewContext(source, {
    document: { documentElement: root },
    localStorage: {
      getItem(key) {
        if (key === "theme") return storedTheme;
        if (key === "halo.appearance") return appearance;
        return null;
      },
    },
    window: {
      matchMedia: (query) => ({ matches: query.includes("reduced-motion") ? systemReduced : systemDark }),
    },
  });
  return { dark: classes.has("dark"), background: root.style.background, styles, attributes };
}

test("uses the system color scheme when no explicit theme is stored", () => {
  assert.equal(initializeTheme(null, true).dark, true);
  assert.equal(initializeTheme(null, false).dark, false);
  assert.equal(initializeTheme("system", true).background, "#000000");
  assert.equal(initializeTheme("system", false).background, "#F2F2F7");
});

test("an explicit theme overrides the system color scheme", () => {
  assert.equal(initializeTheme("light", true).dark, false);
  assert.equal(initializeTheme("dark", false).dark, true);
});

test("defaults to system blue and the default glass appearance", () => {
  const result = initializeTheme(null, false);
  assert.equal(result.styles.get("--color-primary"), "#007AFF");
  assert.equal(result.styles.get("--glass-clarity"), "0.35");
  assert.equal(result.attributes.get("data-motion"), "full");
  assert.equal(result.attributes.get("data-highlight"), "dynamic");
  assert.equal(result.attributes.get("data-contrast"), "normal");
  assert.equal(result.attributes.get("data-bold"), "off");
  assert.equal(result.attributes.get("data-wallpaper"), "soft");
  assert.equal(result.attributes.get("data-refraction"), "on");
});

test("applies a stored appearance before first paint", () => {
  const result = initializeTheme(null, false, {
    appearance: JSON.stringify({ clarity: 0.9, motion: "off", dynamicHighlight: false, increaseContrast: true, boldText: true, wallpaper: "off", refraction: false }),
  });
  assert.equal(result.styles.get("--glass-clarity"), "0.9");
  assert.equal(result.attributes.get("data-motion"), "off");
  assert.equal(result.attributes.get("data-highlight"), "static");
  assert.equal(result.attributes.get("data-contrast"), "high");
  assert.equal(result.attributes.get("data-bold"), "on");
  assert.equal(result.attributes.get("data-wallpaper"), "off");
  assert.equal(result.attributes.get("data-refraction"), "off");
});

test("clamps clarity and follows the OS reduced-motion setting", () => {
  const result = initializeTheme(null, false, { appearance: JSON.stringify({ clarity: 4, motion: "system" }), systemReduced: true });
  assert.equal(result.styles.get("--glass-clarity"), "1");
  assert.equal(result.attributes.get("data-motion"), "reduced");
  assert.equal(initializeTheme(null, false, { appearance: "{broken" }).styles.get("--glass-clarity"), "0.35");
});
