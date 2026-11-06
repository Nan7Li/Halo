import { CheckmarkRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import type { OperatorCandidate } from "./types";
import { useI18n } from "../../lib/i18n";
import { CountryFlag } from "../CountryFlag";

function ratsText(c: OperatorCandidate): string {
  const list = (c.rats || []).filter(Boolean) as string[];
  return list.length ? list.map((r) => r.toUpperCase()).join(" / ") : "--";
}

export function CandidateRow({ candidate, onLock }: { candidate: OperatorCandidate; onLock: (c: OperatorCandidate) => void }) {
  const { t } = useI18n();
  const c = candidate;
  const forbidden = c.status === "forbidden";
  const current = c.status === "current";
  return (
    <button
      type="button"
      role="radio"
      aria-checked={current}
      disabled={forbidden}
      title={forbidden ? t("不可注册") : t("锁定")}
      onClick={() => { if (!forbidden) onLock(c); }}
      className="ios-select-row flex w-full items-center gap-3 px-4 text-left"
    >
      <span className="ios-select-row-body flex min-w-0 flex-1 items-center gap-3 py-2.5">
        <CountryFlag countryCode={c.countryCode} />
        <span className="min-w-0 flex-1">
          <span className={cx("block truncate ios-body", forbidden ? "text-label-3" : "text-label")}>
            {c.operatorName || c.shortName || t("未知网络")}
          </span>
          <span className="mt-0.5 block ios-footnote text-label-2">
            <span className="font-mono">{c.plmn}</span> · {ratsText(c)}
            {forbidden ? <span className="text-sys-red"> · {t("禁用")}</span> : null}
          </span>
        </span>
        <span className="flex w-5 shrink-0 justify-center text-accent [&_svg]:h-5 [&_svg]:w-5">{current ? <CheckmarkRegular /> : null}</span>
      </span>
    </button>
  );
}
