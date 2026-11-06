import { useEffect, useState } from "react";
import {
  CallFilled,
  CheckmarkRegular,
  ChatFilled,
  BoardFilled,
  RouterFilled,
} from "@fluentui/react-icons";
import { ACCENT_PRESETS, normalizeHex, useAccent } from "../../lib/accent";
import { withViewTransition } from "../../lib/motion";
import { useI18n } from "../../lib/i18n";
import { THEME_CHANGE_EVENT, readThemePreference, writeThemePreference, type ThemePreference } from "../../lib/theme";
import { CLARITY_STOPS, clarityLabel, useAppearance, type MotionPreference } from "../../lib/appearance";
import { cx } from "../../lib/utils";
import { IOSSwitch, ListRow, ListSection, SegmentedControl, Slider } from "../ios";

/**
 * Settings > Appearance: light/dark, accent color and the iOS 27 Liquid
 * Glass controls (clarity slider, motion, dynamic highlight, contrast).
 * Every control applies immediately; values are stored per browser.
 */
export function AppearanceSettings() {
  const { t } = useI18n();
  const { accent, setAccent } = useAccent();
  const { appearance, update } = useAppearance();
  const [theme, setTheme] = useState<ThemePreference>(readThemePreference);

  useEffect(() => {
    const sync = () => setTheme(readThemePreference());
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  const themes: Array<{ id: ThemePreference; label: string }> = [
    { id: "light", label: "浅色" },
    { id: "dark", label: "深色" },
    { id: "system", label: "自动" },
  ];

  return (
    <div>
      <GlassPreview />

      <ListSection header="Liquid Glass" footer={t("从超透明到完全着色调节玻璃材质。越透明，背后的内容越清楚；越着色，文字越容易阅读。")}>
        <div className="px-4 pb-4 pt-3">
          <div className="mb-1 flex items-center justify-between">
            <span className="ios-body text-label">{t("质感")}</span>
            <span className="ios-body tabular-nums text-label-2">
              {t(clarityLabel(appearance.clarity))} · {Math.round(appearance.clarity * 100)}%
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="shrink-0 whitespace-nowrap ios-footnote text-label-2">{t("透明")}</span>
            <Slider value={appearance.clarity} onChange={(clarity) => update({ clarity })} ariaLabel={t("玻璃质感")} />
            <span className="shrink-0 whitespace-nowrap ios-footnote text-label-2">{t("着色")}</span>
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {CLARITY_STOPS.map((stop) => (
              <button
                key={stop.value}
                type="button"
                onClick={() => update({ clarity: stop.value })}
                className={cx(
                  "h-8 rounded-full ios-footnote font-semibold ios-press",
                  Math.abs(appearance.clarity - stop.value) < 0.01 ? "bg-accent text-[var(--color-on-primary)]" : "bg-fill-3 text-label",
                )}
              >
                {t(stop.label)}
              </button>
            ))}
          </div>
        </div>
        <ListRow
          title={t("动态高光")}
          subtitle={t("指针移过玻璃时，高光跟着移动")}
          accessory={<IOSSwitch checked={appearance.dynamicHighlight} onChange={(dynamicHighlight) => update({ dynamicHighlight })} ariaLabel={t("动态高光")} />}
        />
        <ListRow
          title={t("增强对比度")}
          subtitle={t("玻璃更不透明，次要文字更深")}
          accessory={<IOSSwitch checked={appearance.increaseContrast} onChange={(increaseContrast) => update({ increaseContrast })} ariaLabel={t("增强对比度")} />}
        />
      </ListSection>

      <ListSection header={t("显示与文字")} footer={t("开启后，所有文字都使用更粗的字重，和 iOS「辅助功能 › 显示与文字大小 › 粗体文本」一致。")}>
        <ListRow
          title={<span className="font-semibold">{t("粗体文本")}</span>}
          accessory={<IOSSwitch checked={appearance.boldText} onChange={(boldText) => update({ boldText })} ariaLabel={t("粗体文本")} />}
        />
      </ListSection>

      <ListSection header={t("动画")} footer={t("「减弱」保留淡入淡出，去掉位移和弹跳；「关闭」不播放任何动画。「跟随系统」会遵循设备的「减弱动态效果」设置。")}>
        <div className="p-3">
          <SegmentedControl<MotionPreference>
            block
            value={appearance.motion}
            onChange={(motion) => update({ motion })}
            options={[
              { value: "system", label: t("跟随系统") },
              { value: "full", label: t("完整") },
              { value: "reduced", label: t("减弱") },
              { value: "off", label: t("关闭") },
            ]}
          />
        </div>
      </ListSection>

      <ListSection header={t("外观")}>
        <div className="grid grid-cols-3 gap-3 px-4 py-4">
          {themes.map((item) => {
            const active = theme === item.id;
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={active}
                onClick={() => withViewTransition(() => writeThemePreference(item.id))}
                className="flex flex-col items-center gap-2 ios-press"
              >
                <ThemeThumb kind={item.id} />
                <span className="ios-subhead text-label">{t(item.label)}</span>
                <span className={cx("inline-flex h-[22px] w-[22px] items-center justify-center rounded-full", active ? "bg-accent text-white" : "border-[1.5px] border-label-4")}>
                  {active ? <CheckmarkRegular className="h-3.5 w-3.5" /> : null}
                </span>
              </button>
            );
          })}
        </div>
      </ListSection>

      <ListSection header={t("强调色")}>
        <div className="flex flex-wrap items-center gap-3.5 px-4 py-4">
          {ACCENT_PRESETS.map((preset) => {
            const active = accent.toUpperCase() === preset.hex.toUpperCase();
            return (
              <button
                key={preset.id}
                type="button"
                title={t(preset.label)}
                aria-label={t(preset.label)}
                aria-pressed={active}
                onClick={() => withViewTransition(() => setAccent(preset.hex))}
                className={cx("h-8 w-8 rounded-full ios-press", active && "ring-2 ring-offset-2 ring-offset-grouped-2")}
                style={{ background: preset.hex, ["--tw-ring-color" as string]: preset.hex }}
              />
            );
          })}
          <label
            className="relative h-8 w-8 cursor-pointer rounded-full"
            style={{ background: "conic-gradient(#ff3b30, #ff9500, #ffcc00, #34c759, #30b0c7, #007aff, #5856d6, #af52de, #ff2d55, #ff3b30)" }}
            title={t("自定义颜色")}
          >
            <input
              type="color"
              value={normalizeHex(accent) || accent}
              onChange={(event) => setAccent(event.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
              aria-label={t("自定义颜色")}
            />
          </label>
        </div>
      </ListSection>
    </div>
  );
}

/** A colorful scene with real glass controls on top, so changes are visible live. */
function GlassPreview() {
  const { t } = useI18n();
  return (
    <div className="relative mb-7 h-[230px] overflow-hidden rounded-[28px] bg-[#0d1b2a]">
      <div
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(45% 60% at 18% 30%, #ff9f0a 0%, transparent 70%), radial-gradient(40% 55% at 70% 25%, #ff375f 0%, transparent 70%), radial-gradient(50% 60% at 55% 85%, #0a84ff 0%, transparent 70%), radial-gradient(35% 45% at 95% 80%, #30d158 0%, transparent 70%), linear-gradient(135deg, #5e5ce6, #1c1c1e)",
        }}
      />
      <div className="absolute left-5 right-5 top-5 space-y-1.5 text-white/90 [text-shadow:0_1px_2px_rgb(0_0_0/0.3)]">
        <div className="ios-title-2">Liquid Glass</div>
        <div className="max-w-[320px] ios-footnote">{t("玻璃浮在内容上方。拖动下面的滑块，看材质从超透明变成完全着色。")}</div>
      </div>
      <div className="absolute right-5 top-5 flex gap-2">
        <span className="glass glass-interactive inline-flex h-10 w-10 items-center justify-center rounded-full text-label">
          <CallFilled className="h-5 w-5" />
        </span>
      </div>
      <div className="absolute inset-x-0 bottom-4 flex justify-center">
        <div className="glass flex h-[58px] items-center gap-1 rounded-full p-1">
          {[BoardFilled, CallFilled, ChatFilled, RouterFilled].map((Icon, index) => (
            <span
              key={index}
              className={cx("inline-flex h-[50px] w-[64px] items-center justify-center rounded-full", index === 1 ? "bg-fill-3 text-accent" : "text-label")}
            >
              <Icon className="h-6 w-6" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThemeThumb({ kind }: { kind: ThemePreference }) {
  const half = kind === "system";
  const dark = kind === "dark";
  return (
    <span className="relative block h-[88px] w-[54px] overflow-hidden rounded-[12px] shadow-[0_0_0_0.5px_rgb(0_0_0/0.18),0_4px_12px_rgb(0_0_0/0.12)]">
      <span className={cx("absolute inset-0", dark ? "bg-black" : "bg-[#f2f2f7]")} />
      {half ? <span className="absolute inset-y-0 right-0 w-1/2 bg-black" /> : null}
      <span className="absolute inset-x-2 top-3 space-y-1.5">
        {[0, 1, 2].map((row) => (
          <span key={row} className={cx("block h-2 rounded-full", dark ? "bg-[#2c2c2e]" : "bg-white")} style={half ? { background: "linear-gradient(90deg, #fff 50%, #2c2c2e 50%)" } : undefined} />
        ))}
      </span>
      <span className="absolute inset-x-2 bottom-2 h-3 rounded-full" style={{ background: dark ? "rgb(60 60 64 / 0.9)" : half ? "linear-gradient(90deg, rgb(255 255 255 / 0.9) 50%, rgb(60 60 64 / 0.9) 50%)" : "rgb(255 255 255 / 0.9)" }} />
    </span>
  );
}
