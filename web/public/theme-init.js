// Runs before first paint: theme, accent and Liquid Glass appearance, so the
// page never flashes the wrong colors. Keep in sync with lib/theme.ts,
// lib/accent.ts and lib/appearanceModel.ts.
try {
  var theme = localStorage.getItem("theme");
  var followsSystem = !theme || theme === "system";
  var dark = theme === "dark" || (followsSystem && window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  var root = document.documentElement;
  root.classList.toggle("dark", dark);
  root.style.background = dark ? "#000000" : "#F2F2F7";

  var stored = localStorage.getItem("halo.accent") || "#007AFF";
  var raw = String(stored).replace("#", "");
  if (/^[0-9a-fA-F]{3}$/.test(raw)) raw = raw.split("").map(function (ch) { return ch + ch; }).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) raw = "007AFF";
  var n = parseInt(raw, 16);
  var r = (n >> 16) & 255;
  var g = (n >> 8) & 255;
  var b = n & 255;
  var mix = function (t) {
    var rr = Math.max(0, Math.min(255, Math.round(r + (0 - r) * t)));
    var gg = Math.max(0, Math.min(255, Math.round(g + (0 - g) * t)));
    var bb = Math.max(0, Math.min(255, Math.round(b + (0 - b) * t)));
    return "#" + [rr, gg, bb].map(function (v) { return v.toString(16).padStart(2, "0"); }).join("");
  };
  var srgb = [r, g, b].map(function (v) {
    v = v / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  });
  var lum = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
  var hex = "#" + raw.toUpperCase();
  root.style.setProperty("--color-primary", hex);
  root.style.setProperty("--color-primary-hover", mix(0.16));
  root.style.setProperty("--color-primary-active", mix(0.28));
  root.style.setProperty("--color-primary-ink", mix(0.22));
  root.style.setProperty("--color-primary-soft", "rgba(" + r + ", " + g + ", " + b + ", 0.16)");
  root.style.setProperty("--color-primary-faint", "rgba(" + r + ", " + g + ", " + b + ", 0.08)");
  root.style.setProperty("--color-primary-border", "rgba(" + r + ", " + g + ", " + b + ", 0.32)");
  root.style.setProperty("--color-primary-rgb", r + " " + g + " " + b);
  root.style.setProperty("--color-on-primary", lum > 0.45 ? "#1C1C1E" : "#FFFFFF");
  root.style.setProperty("--el-color-primary", hex);
  root.style.setProperty("--el-color-primary-dark-2", mix(0.16));

  // Platform idiom: a fine pointer on a wide window gets macOS metrics
  // (13pt text, smaller controls); touch screens and narrow windows get iOS.
  var mac = !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine) and (min-width: 1024px)").matches);
  root.setAttribute("data-idiom", mac ? "mac" : "ios");

  var appearance = {};
  try { appearance = JSON.parse(localStorage.getItem("halo.appearance") || "{}") || {}; } catch (e) { appearance = {}; }
  var clarity = Number(appearance.clarity);
  if (appearance.clarity === undefined || !isFinite(clarity)) clarity = 0.35;
  clarity = Math.round(Math.min(1, Math.max(0, clarity)) * 100) / 100;
  var motion = appearance.motion;
  if (motion !== "full" && motion !== "reduced" && motion !== "off") {
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    motion = reduce ? "reduced" : "full";
  }
  root.style.setProperty("--glass-clarity", String(clarity));
  root.setAttribute("data-motion", motion);
  root.setAttribute("data-highlight", appearance.dynamicHighlight === false ? "static" : "dynamic");
  root.setAttribute("data-contrast", appearance.increaseContrast === true ? "high" : "normal");
  root.setAttribute("data-bold", appearance.boldText === true ? "on" : "off");
} catch (e) {}
