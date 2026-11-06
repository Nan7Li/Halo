import { useState } from "react";
import {
  AddRegular,
  CheckmarkRegular,
  CopyRegular,
  KeyRegular,
} from "@fluentui/react-icons";
import type { ApiTokenListItem } from "../../types";
import { apiMessage, createApiToken } from "../../api";
import { tf, useI18n } from "../../lib/i18n";
import { Button, Input, ListSkeleton, Modal, Select, confirmDialog, message } from "../ui";
import { cx } from "../../lib/utils";
import { ToggleRow } from "../proxy/formUi";
import { CardDecor, CardIcon, CardTitle } from "./Cards";
import { Field, copyText } from "./controls";


interface CreateTokenForm {
  name: string;
  readOnly: boolean;
  ttlHours: number;
}

const EMPTY_FORM: CreateTokenForm = { name: "", readOnly: false, ttlHours: 0 };

interface CreatedToken {
  token: string;
  name: string;
  readOnly: boolean;
  expiresAt: string;
}

function formatTime(value: string, never: string): string {
  if (!value) return never;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

// List rows show dates only (like iOS Settings); the full time is in the title.
function formatDate(value: string, never: string): string {
  if (!value) return never;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString();
}

// API 令牌管理：列表、创建与吊销。创建响应中的明文令牌仅在一次性
// 弹窗中展示；刷新后的列表永远只包含元数据。
export function ApiTokensCard({
  tokens,
  loading,
  error,
  revoking,
  onRevoke,
  onRefresh,
}: {
  tokens: ApiTokenListItem[];
  loading: boolean;
  error: boolean;
  revoking: string | null;
  onRevoke: (name: string) => void;
  onRefresh: () => void;
}) {
  const { t } = useI18n();
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState<CreateTokenForm>(EMPTY_FORM);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedToken | null>(null);
  const [copied, setCopied] = useState(false);

  const ttlOptions = [
    { value: "0", label: t("永不过期") },
    { value: "24", label: t("24 小时") },
    { value: "168", label: t("7 天") },
    { value: "720", label: t("30 天") },
    { value: "8760", label: t("365 天") },
  ];

  const onCreate = async () => {
    setCreating(true);
    try {
      const data = await createApiToken({
        name: form.name.trim(),
        readOnly: form.readOnly,
        ttlHours: form.ttlHours,
      });
      setCreateOpen(false);
      setCopied(false);
      setCreated({
        token: data.token,
        name: data.name,
        readOnly: data.readOnly,
        expiresAt: data.expiresAt ?? "",
      });
      setForm(EMPTY_FORM);
      onRefresh();
    } catch (e) {
      message.error(apiMessage(e));
    } finally {
      setCreating(false);
    }
  };

  const copyToken = async () => {
    if (!created) return;
    // HTTP deployments have no navigator.clipboard; copyText falls back to
    // the textarea + execCommand path and reports its own toast.
    if (await copyText(created.token)) setCopied(true);
  };

  return (
    <div className="ui-card group relative overflow-hidden p-8 lg:col-span-2">
      <CardDecor />
      <div className="relative z-10 mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <CardIcon>
            <KeyRegular className="text-[24px]" />
          </CardIcon>
          <CardTitle
            title={t("API 令牌")}
            subtitle={t("供脚本与 MCP 客户端使用的 Bearer 凭据，也可在设备上用 vocat token create 创建")}
          />
        </div>
        <Button variant="primary" onClick={() => setCreateOpen(true)}>
          <span className="flex items-center gap-1.5">
            <AddRegular className="text-[16px]" />
            {t("创建令牌")}
          </span>
        </Button>
      </div>

      {loading ? (
        <ListSkeleton rows={2} />
      ) : error ? (
        <div role="alert" className="flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-sys-red/10 px-4 py-3 ios-subhead text-sys-red">
          <span>{t("令牌列表加载失败")}</span>
          <Button variant="default" onClick={onRefresh}>
            {t("重试")}
          </Button>
        </div>
      ) : tokens.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-4 text-sm text-gray-500 dark:border-gray-700">
          {t("尚未创建任何 API 令牌。点击右上角「创建令牌」，或在设备上运行 vocat token create。")}
        </div>
      ) : (
        <div className="ios-card-list">
          {tokens.map((token) => (
            <div key={token.name} className="ios-select-row flex items-center gap-3 px-4">
              <span className="ios-select-row-body flex min-w-0 flex-1 items-center gap-3 py-2.5">
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate ios-body font-medium text-label">{token.name}</span>
                    <span className={cx("shrink-0 rounded-full px-2 py-px ios-caption font-semibold", token.readOnly ? "bg-sys-green/15 text-sys-green" : "bg-sys-orange/15 text-sys-orange")}>
                      {token.readOnly ? t("只读") : t("读写")}
                    </span>
                  </span>
                  <span
                    className="mt-0.5 block ios-footnote text-label-2"
                    title={`${t("创建时间")} ${formatTime(token.createdAt, "-")}\n${t("最后使用")} ${formatTime(token.lastUsedAt, t("从未使用"))}\n${t("过期时间")} ${formatTime(token.expiresAt, t("永不过期"))}`}
                  >
                    {t("最后使用")} {formatDate(token.lastUsedAt, t("从未使用"))} · {token.expiresAt ? `${t("过期时间")} ${formatDate(token.expiresAt, "")}` : t("永不过期")}
                  </span>
                </span>
                <button
                  type="button"
                  className="shrink-0 ios-body text-sys-red disabled:opacity-40"
                  disabled={revoking !== null}
                  onClick={async () => {
                    const ok = await confirmDialog(
                      tf("确定吊销令牌「{name}」？使用它的脚本与 MCP 客户端将立即失去访问权限。", { name: token.name }),
                      t("确认吊销"),
                      { type: "warning", confirmText: t("吊销"), cancelText: t("取消") },
                    );
                    if (ok) onRevoke(token.name);
                  }}
                >
                  {revoking === token.name ? t("吊销中…") : t("吊销")}
                </button>
              </span>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title={t("创建 API 令牌")}
        footer={
          <div className="flex justify-end gap-3">
            <Button variant="text" onClick={() => setCreateOpen(false)}>
              {t("取消")}
            </Button>
            <Button
              variant="primary"
              loading={creating}
              disabled={!form.name.trim()}
              onClick={() => void onCreate()}
            >
              {t("创建")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Field label={t("名称")} hint={t("1-64 个字母、数字、点、下划线或连字符")}>
            <Input
              value={form.name}
              placeholder={t("例如 ci-runner、home-assistant")}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </Field>
          <Field label={t("有效期")}>
            <Select
              value={String(form.ttlHours)}
              options={ttlOptions}
              onChange={(value) => setForm((prev) => ({ ...prev, ttlHours: Number(value) }))}
            />
          </Field>
        </div>
        <div className="mt-6 space-y-4">
          <ToggleRow
            title={t("只读令牌")}
            subtitle={t("仅能调用查询类接口，不能发送短信、切换 eSIM 或触发重连")}
            checked={form.readOnly}
            onChange={(checked) => setForm((prev) => ({ ...prev, readOnly: checked }))}
          />
        </div>
      </Modal>

      <Modal
        open={created !== null}
        onClose={() => setCreated(null)}
        title={t("令牌已创建")}
        closeOnOverlay={false}
        footer={
          <div className="flex justify-end">
            <Button variant="primary" onClick={() => setCreated(null)}>
              {t("我已妥善保存")}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="rounded-[var(--radius-md)] bg-sys-orange/15 px-4 py-3 ios-subhead text-sys-orange">
            {t("此令牌仅显示这一次，关闭后无法再查看。请立即复制并保存到凭据管理器。")}
          </div>
          <div className="flex items-center gap-3">
            <code className="flex-1 overflow-x-auto rounded-[var(--radius-md)] bg-fill-3 px-4 py-3 font-mono ios-subhead text-label break-all">
              {created?.token}
            </code>
            <Button variant={copied ? "success" : "default"} onClick={() => void copyToken()}>
              <span className="flex items-center gap-1.5">
                {copied ? <CheckmarkRegular className="text-[16px]" /> : <CopyRegular className="text-[16px]" />}
                {copied ? t("已复制") : t("复制")}
              </span>
            </Button>
          </div>
          {created ? (
            <div className="px-1 ios-footnote text-label-2">
              {tf("名称：{name} · {scope} · {expires}", {
                name: created.name,
                scope: created.readOnly ? t("只读") : t("读写"),
                expires: formatTime(created.expiresAt, t("永不过期")),
              })}
            </div>
          ) : null}
        </div>
      </Modal>
    </div>
  );
}
