import { useEffect, useMemo, useState } from "react";
import type { Country, CountryRule, UpstreamProxy } from "../../types";
import { Button, EmptyState, Modal, Select } from "../ui";
import { SearchField } from "../ios";
import { useI18n } from "../../lib/i18n";

export interface CountryRulesDialogProps {
  open: boolean;
  proxies: UpstreamProxy[];
  countries: Country[];
  rules: CountryRule[];
  busy: boolean;
  onSave: (assignments: Record<string, string>) => void;
  onClose: () => void;
}

export function CountryRulesDialog(props: CountryRulesDialogProps) {
  const { t, lang } = useI18n();
  const { open, proxies, countries, rules, busy, onSave, onClose } = props;
  const [query, setQuery] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string>>({});
  const regionNames = useMemo(() => {
    try {
      return new Intl.DisplayNames([lang === "zh" ? "zh-CN" : "en"], { type: "region" });
    } catch {
      return null;
    }
  }, [lang]);
  const countryLabel = (country: Country) => regionNames?.of(country.countryCode) || country.countryName || country.countryCode;
  const proxyOptions = useMemo(() => [
    { value: "", label: t("直连") },
    ...proxies.map((proxy) => ({
      value: proxy.id,
      label: proxy.enabled ? (proxy.name || proxy.id) : `${proxy.name || proxy.id}（${t("已禁用")}）`,
      disabled: !proxy.enabled,
    })),
  ], [proxies, t, lang]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setAssignments({});
      return;
    }
    setAssignments(Object.fromEntries(rules.filter((rule) => rule.enabled).map((rule) => [rule.countryCode, rule.upstreamProxyId])));
    // Sample rules only when opening. Polling must not discard in-progress edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return [...countries]
      .sort((a, b) => countryLabel(a).localeCompare(countryLabel(b), lang === "zh" ? "zh-CN" : "en"))
      .filter((country) => {
        if (!needle) return true;
        return [country.countryCode, country.countryName, countryLabel(country), ...country.mccs]
          .some((value) => String(value || "").toLocaleLowerCase().includes(needle));
      });
  }, [countries, query, lang, regionNames]);

  const configuredCount = Object.values(assignments).filter(Boolean).length;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t("MCC 国家规则")}
      footer={(
        <>
          <Button onClick={onClose} disabled={busy}>{t("取消")}</Button>
          <Button variant="primary" loading={busy} onClick={() => onSave(assignments)}>{t("保存规则")}</Button>
        </>
      )}
    >
      <div className="space-y-3 pb-1">
        <p className="px-1 ios-footnote text-label-2">
          {t("为每个国家的 MCC 选择代理。未配置时直连；已有 ICCID 绑定始终优先，首次命中国家规则后会生成独立的 ICCID 绑定。")}
        </p>
        <SearchField value={query} onChange={setQuery} placeholder={t("搜索国家、地区代码或 MCC")} />
        <div className="px-1 ios-footnote font-medium uppercase text-label-2">
          {configuredCount} {t("个国家规则")}
        </div>
        {filtered.length === 0 ? (
          <EmptyState title={t("没有匹配的国家或 MCC")} />
        ) : (
          <div className="max-h-[55vh] overflow-auto rounded-[var(--radius-lg)] bg-grouped-2 px-4">
            {filtered.map((country) => (
              <div key={country.countryCode} className="ios-form-row items-center">
                <div className="ios-form-label !pt-0">
                  <div className="truncate">{countryLabel(country)}</div>
                  <div className="truncate font-mono ios-caption text-label-2">
                    {country.countryCode} · MCC {country.mccs.join(", ")}
                  </div>
                </div>
                <div className="ios-form-control">
                  <Select
                    value={assignments[country.countryCode] || ""}
                    options={proxyOptions}
                    disabled={busy}
                    onChange={(value) => setAssignments((current) => ({ ...current, [country.countryCode]: value }))}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
