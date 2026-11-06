import { useCallback, useEffect, useState } from "react";
import { HistoryRegular } from "@fluentui/react-icons";
import { apiMessage, getLoggingSettings, updateLoggingSettings } from "../../api";
import type { LoggingSettings } from "../../types";
import { ListSection } from "../ios";
import { useI18n } from "../../lib/i18n";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { message } from "../ui/message";

type RetentionMode = LoggingSettings["mode"];
type RetentionLevel = LoggingSettings["level"];

// 运行日志保留策略：默认不限制，可按条数或天数限制，并可按最低日志级别保留。
export function LogRetentionCard({ refreshKey = 0 }: { refreshKey?: number }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<RetentionMode>("unlimited");
  const [count, setCount] = useState(10000);
  const [days, setDays] = useState(30);
  const [level, setLevel] = useState<RetentionLevel>("debug");
  const [storedLogs, setStoredLogs] = useState(0);
  const [maxLogs, setMaxLogs] = useState(10000);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const apply = useCallback((data: LoggingSettings) => {
    setMode(data.mode);
    setCount(data.count);
    setDays(data.days);
    setLevel(data.level || "debug");
    setStoredLogs(data.storedLogs);
    setMaxLogs(data.maxLogs || 10000);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLoggingSettings()
      .then((data) => {
        if (!cancelled) apply(data);
      })
      .catch(() => message.error(t("日志保留策略加载失败")))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [apply, refreshKey]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const data = await updateLoggingSettings({
        mode,
        count: Math.min(maxLogs, Math.max(1, Math.trunc(count) || 1)),
        days: Math.max(1, Math.trunc(days) || 1),
        level,
      });
      apply(data);
      message.success(t("日志保留策略已保存"));
    } catch (error) {
      message.error(apiMessage(error) || t("日志保留策略保存失败"));
    } finally {
      setSaving(false);
    }
  }, [mode, count, days, level, maxLogs, apply]);

  const onNumber = (setter: (value: number) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const parsed = parseInt(event.target.value, 10);
    setter(Number.isNaN(parsed) ? 0 : parsed);
  };

  const row = (label: string, control: React.ReactNode) => (
    <div className="ios-form-row">
      <label className="ios-form-label">{label}</label>
      <div className="ios-form-control">{control}</div>
    </div>
  );
  return (
    <ListSection
      className="mt-6"
      header={
        <span className="flex items-end justify-between gap-3">
          <span className="inline-flex items-center gap-1.5"><HistoryRegular className="h-4 w-4" />{t("日志保留")}</span>
          <button type="button" className="ios-subhead font-medium text-accent disabled:opacity-40" disabled={loading || saving} onClick={save}>
            {saving ? t("保存中…") : t("保存")}
          </button>
        </span>
      }
      footer={<>{t("当前已存储")} {storedLogs} / {maxLogs} {t("条")} · {t("达到上限后自动删除最旧日志")}</>}
      bodyClassName="px-4"
    >
      {row(t("保留方式"), (
        <Select
          value={mode}
          onChange={(value) => setMode(value as RetentionMode)}
          disabled={loading}
          options={[
            { value: "unlimited", label: t("最多 10000 条") },
            { value: "count", label: t("按条数") },
            { value: "days", label: t("按天数") },
          ]}
        />
      ))}
      {mode === "count" ? row(t("条数"), (
        <Input type="number" inputMode="numeric" min={1} max={maxLogs} value={count === 0 ? "" : count} onChange={onNumber(setCount)} disabled={loading} />
      )) : null}
      {mode === "days" ? row(t("天数"), (
        <Input type="number" inputMode="numeric" min={1} value={days === 0 ? "" : days} onChange={onNumber(setDays)} disabled={loading} />
      )) : null}
      {row(t("类型保留"), (
        <Select
          value={level}
          onChange={(value) => setLevel(value as RetentionLevel)}
          disabled={loading}
          options={[
            { value: "debug", label: t("DEBUG 及以上") },
            { value: "info", label: t("INFO 及以上") },
            { value: "warn", label: t("WARN 及以上") },
            { value: "error", label: t("ERROR (仅严重报错)") },
          ]}
        />
      ))}
    </ListSection>
  );
}
