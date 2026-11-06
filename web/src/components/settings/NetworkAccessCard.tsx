import {
  CheckmarkRegular,
  GlobeRegular,
  WarningRegular,
} from "@fluentui/react-icons";
import type { SecuritySettings } from "../../types";
import { useI18n } from "../../lib/i18n";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { CardDecor, CardIcon, CardTitle } from "./Cards";
import { SegmentedTabs } from "./controls";
import { ToggleRow } from "../proxy/formUi";

export interface NetworkAccessForm {
  mode: SecuritySettings["mode"];
  allowedCidrs: string[];
  trustProxyHeaders: boolean;
}


// 网络访问控制：默认仅放行内网网段，可切换对公网开放，并支持额外放行网段。
export function NetworkAccessCard({
  value,
  clientIp,
  clientAllowed,
  loading,
  saving,
  onChange,
  onSave,
}: {
  value: NetworkAccessForm;
  clientIp: string;
  clientAllowed: boolean;
  loading: boolean;
  saving: boolean;
  onChange: (patch: Partial<NetworkAccessForm>) => void;
  onSave: () => void;
}) {
  const { t } = useI18n();
  const cidrs = value.allowedCidrs;
  const setCidrs = (next: string[]) => onChange({ allowedCidrs: next });

  return (
    <div className="ui-card group relative overflow-hidden p-8 lg:col-span-2">
      <CardDecor />
      <div className="relative z-10 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CardIcon>
            <GlobeRegular className="text-[24px]" />
          </CardIcon>
          <CardTitle title={t("网络访问")} subtitle={t("控制允许访问系统的来源网段")} />
        </div>
        <Button
          variant="primary"
          loading={saving}
          disabled={loading}
          onClick={onSave}
          className="!border-0"
        >
          <CheckmarkRegular />
          {t("保存访问策略")}
        </Button>
      </div>

      {loading ? (
        <div className="py-6 text-center ios-footnote text-label-2">{t("正在加载访问策略…")}</div>
      ) : (
        <div className="relative z-10 space-y-6">
          <div>
            <SegmentedTabs
              tabs={[
                { key: "internal", label: t("内网优先") },
                { key: "public", label: t("对公网开放") },
              ]}
              value={value.mode}
              onChange={(mode) => onChange({ mode: mode as NetworkAccessForm["mode"] })}
            />
            <p className="-mt-3 ios-footnote text-label-2">
              {value.mode === "public"
                ? t("允许任意来源 IP 访问（含公网）。仅在已设置强密码且网络环境可信时使用。")
                : t("默认仅允许内网网段访问：10/8、172.16/12、192.168/16、169.254/16、127/8、::1、fe80::/10、fc00::/7。")}
            </p>
          </div>

          {value.mode === "public" ? (
            <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-sys-orange/15 px-4 py-3 ios-subhead text-sys-orange">
              <WarningRegular className="mt-0.5 shrink-0" />
              <span>{t("对公网开放会显著扩大攻击面，请务必使用强密码并尽快切回内网优先。")}</span>
            </div>
          ) : null}

          <div>
            <div className="flex items-end justify-between gap-3 pb-1">
              <h4 className="ios-footnote font-medium uppercase text-label-2">{t("额外放行网段")}</h4>
              <button type="button" className="ios-subhead font-medium text-accent" onClick={() => setCidrs([...cidrs, ""])}>
                {t("添加网段")}
              </button>
            </div>
            {cidrs.length ? (
              <div className="ios-group-lines">
                {cidrs.map((cidr, index) => (
                  <div key={index} className="ios-form-row items-center">
                    <button
                      type="button"
                      aria-label={t("删除")}
                      title={t("删除")}
                      onClick={() => setCidrs(cidrs.filter((_, i) => i !== index))}
                      className="ios-minus-button"
                    />
                    <div className="ios-form-control">
                      <Input
                        value={cidr}
                        onChange={(event) => setCidrs(cidrs.map((item, i) => (i === index ? event.target.value : item)))}
                        placeholder="192.168.0.0/16"
                        inputMode="url"
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mt-1.5 ios-footnote text-label-2">
              {cidrs.length ? null : <>{t("暂无额外放行网段")}。</>}
              {t("在内置内网网段之外始终放行的 CIDR 或单个 IP；也允许通知推送访问这些目标地址（例如 198.18.0.0/15）。")}
            </p>
          </div>

          <div className="ios-group-lines">
            <ToggleRow
              title={t("信任代理请求头")}
              subtitle={t("仅在系统位于可信反向代理之后时开启，按 X-Forwarded-For 判定来源；否则客户端可伪造该头绕过内网限制。")}
              checked={value.trustProxyHeaders}
              onChange={(trustProxyHeaders) => onChange({ trustProxyHeaders })}
            />
          </div>

          {!clientAllowed && (
            <div className="flex items-start gap-2 rounded-[var(--radius-md)] bg-sys-red/10 px-4 py-3 ios-subhead text-sys-red">
              <WarningRegular className="mt-0.5 shrink-0" />
              <span>
                <span className="font-mono">{clientIp || "--"}</span> {t("当前连接将被拒绝，保存后可能无法继续访问")}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
