import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api";
import { useI18n } from "../../lib/i18n";
import type { AutoUpdateSettings, SystemInfo } from "../../types";

export function VersionBadge({ compact = false }: { compact?: boolean }) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [version, setVersion] = useState<string>("");
  const [hasUpdate, setHasUpdate] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api<SystemInfo>("/system/info")
      .then((info) => {
        if (!cancelled) setVersion(info?.version ?? "");
      })
      .catch(() => {
        // A failed info probe leaves the badge at its dev fallback; the
        // shell still renders and other clusters are unaffected.
      });
    const checkUpdate = () => {
      api<AutoUpdateSettings>("/settings/auto-update")
        .then((info) => {
          if (cancelled) return;
          if (info?.lastAvailable) {
            setHasUpdate(true);
            return;
          }
          return api<{ available?: boolean }>("/system/update/check", { timeoutMs: 30000 }).then((check) => {
            if (!cancelled) setHasUpdate(!!check?.available);
          });
        })
        .catch(() => undefined);
    };
    void checkUpdate();
    const timer = window.setInterval(checkUpdate, 5 * 60 * 1000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);

  const label = version ? `v${version}` : "vdev";
  // "1.1.15-cellbridge-preview.20261108153013": the sidebar shows the
  // release and a Preview tag; the full build string is the tooltip.
  const [release, ...rest] = version.split("-");
  const prerelease = rest.length > 0;
  const title = hasUpdate ? "有新版本，点击打开设置更新" : version ? `Halo v${version}` : "Halo preview";
  if (compact) {
    return (
      <button
        type="button"
        onClick={() => navigate("/settings/system")}
        title={version ? `Halo v${version}` : title}
        className="ios-press flex min-w-0 max-w-full items-center gap-1.5 ios-caption text-label-2 hover:text-label"
      >
        <span className="truncate tabular-nums">{version ? `v${release}` : label}</span>
        {prerelease ? <span className="shrink-0 rounded-full bg-fill-3 px-1.5 text-[10px] font-semibold leading-4 text-label-2">{t("预览版")}</span> : null}
        {hasUpdate ? <span className="shrink-0 rounded-full bg-sys-red px-1.5 text-[10px] font-semibold leading-4 text-white">NEW</span> : null}
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => navigate("/settings/system")}
      className="relative flex h-[34px] items-center justify-center rounded-full px-3 font-mono text-[12px] tracking-tight text-label-2 transition-colors hover:bg-fill-3 hover:text-label"
      title={title}
    >
      {label}
      {hasUpdate ? <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-sys-red" aria-label="Update available" /> : null}
    </button>
  );
}
