import { AddRegular, ArrowDownloadRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { Button, Input, Select } from "../ui";
import type { EsimChipInfo, EsimDownloadForm } from "./types";
import { tf, useI18n } from "../../lib/i18n";

export interface EsimDownloadFormProps {
  form: EsimDownloadForm;
  chipInfo: EsimChipInfo | null;
  downloading: boolean;
  downloadPct: number;
  downloadMsg: string;
  downloadErr: string;
  onFormChange: (next: EsimDownloadForm) => void;
  onDownload: () => void;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ios-form-row">
      <label className="ios-form-label">{label}</label>
      <div className="ios-form-control">{children}</div>
    </div>
  );
}

/**
 * "Download new profile" as an iOS inset-grouped form: a section header,
 * one card of leading-label rows (like Settings > Cellular > Add eSIM >
 * Enter Details Manually), progress below, then the primary action.
 */
export function EsimDownloadForm(props: EsimDownloadFormProps) {
  const { t } = useI18n();
  const { form, chipInfo } = props;
  const set = (patch: Partial<EsimDownloadForm>) => props.onFormChange({ ...form, ...patch });
  const eidOptions = (chipInfo?.eids || []).map((e, i) => ({
    value: e.aid || "",
    label: tf("eUICC #{n} (...{tail}) — {free} 可用", { n: i + 1, tail: e.eid.slice(-4), free: e.freeNvram }),
  }));
  const pct = Math.max(0, Math.min(100, props.downloadPct));
  return (
    <section className="min-w-0">
      <h3 className="flex items-center gap-1.5 px-4 pb-1.5 ios-footnote font-medium uppercase text-label-2">
        <AddRegular className="h-3.5 w-3.5" />
        {t("下载新 Profile")}
      </h3>
      <div className="ios-card px-4">
        <Field label={t("SM-DP+ 地址")}>
          <Input value={form.smdp} onChange={(e) => set({ smdp: e.target.value })} placeholder={t("必填")} required autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <Field label="Matching ID">
          <Input value={form.matchingId} onChange={(e) => set({ matchingId: e.target.value })} placeholder={t("可选")} autoCapitalize="none" autoCorrect="off" spellCheck={false} />
        </Field>
        <Field label={t("确认码")}>
          <Input value={form.confirmationCode} onChange={(e) => set({ confirmationCode: e.target.value })} placeholder={t("可选")} />
        </Field>
        <Field label={t("目标 eUICC")}>
          <Select className="min-w-0" value={form.aidHex} onChange={(v) => set({ aidHex: v })} placeholder={t("选择目标 eUICC")} options={eidOptions} />
        </Field>
      </div>
      {props.downloading || props.downloadErr ? (
        <div className="mt-3 space-y-1.5 px-4">
          <div className="h-1 w-full overflow-hidden rounded-full bg-fill-3">
            <div
              className={cx(
                "h-full w-full origin-left rounded-full transition-transform duration-700 ease-spring-snappy",
                props.downloadErr ? "bg-sys-red" : pct >= 100 ? "bg-sys-green" : "bg-accent",
              )}
              style={{ transform: `scaleX(${pct / 100})` }}
            />
          </div>
          <div className={cx("ios-footnote", props.downloadErr ? "text-sys-red" : "text-label-2")}>
            {props.downloadErr || props.downloadMsg}
          </div>
        </div>
      ) : (
        <p className="mt-1.5 px-4 ios-footnote text-label-2">{t("填写运营商提供的 SM-DP+ 地址（例如 rsp.truphone.com）和激活码，下载后需在列表中启用。")}</p>
      )}
      <div className="mt-4 flex justify-stretch sm:justify-end">
        <Button variant="primary" loading={props.downloading} disabled={props.downloading || !form.smdp.trim()} onClick={props.onDownload} className="!border-0 w-full sm:w-auto" icon={<ArrowDownloadRegular />}>
          {t("开始下载")}
        </Button>
      </div>
    </section>
  );
}
