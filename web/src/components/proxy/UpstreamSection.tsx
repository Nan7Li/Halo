import { useState } from "react";
import { DeleteRegular, DesktopRegular, EditRegular, GlobeRegular, MoreHorizontalRegular } from "@fluentui/react-icons";
import type { UpstreamProxy } from "../../types";
import type { LoadError, UpstreamRow } from "./shared";
import { useI18n } from "../../lib/i18n";
import { ContentUnavailable, ContextMenu, IOSSwitch, ListRow, ListSection } from "../ios";
import { ListSkeleton } from "../ui";

export interface UpstreamSectionProps {
  rows: UpstreamRow[];
  loading: boolean;
  error: LoadError | null;
  onRetry: () => void;
  onEdit: (proxy: UpstreamProxy) => void;
  onDelete: (proxy: UpstreamProxy) => void;
  onOpenBindings: (proxy: UpstreamProxy) => void;
  onToggle: (proxy: UpstreamProxy) => void;
  toggleBusyId?: string;
}

/**
 * Upstream proxies as an iOS list: name and address, bindings and country
 * rules as the second line, an on/off switch, and the remaining actions in
 * a menu (tap "…", right-click, or swipe on touch screens).
 */
export function UpstreamSection({ rows, loading, error, onRetry, onEdit, onDelete, onOpenBindings, onToggle, toggleBusyId }: UpstreamSectionProps) {
  const { t } = useI18n();
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const menuRow = rows.find((row) => row.id === menu?.id);

  if (loading && !rows.length) return <ListSkeleton rows={3} />;

  return (
    <>
      {error ? (
        <div className="mb-4 flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-sys-red/10 px-4 py-3 ios-subhead text-sys-red">
          <span className="min-w-0 truncate">
            {t("加载上游代理失败")}：{error.message}
            {error.status ? `（${error.status}）` : ""}
          </span>
          <button type="button" className="shrink-0 font-semibold" onClick={onRetry}>
            {t("重试")}
          </button>
        </div>
      ) : null}
      {!rows.length ? (
        <ContentUnavailable
          icon={<GlobeRegular />}
          title={t("暂无上游代理")}
          description={t("点击“新增代理”创建 SOCKS5 上游代理，再配置国家规则或 ICCID 绑定；未匹配的卡默认直连。")}
        />
      ) : (
        <ListSection header={t("上游代理")}>
          {rows.map((row) => (
            <ListRow
              key={row.id}
              icon={<GlobeRegular />}
              iconColor={row.enabled ? "blue" : "gray"}
              onClick={() => onEdit(row)}
              chevron={false}
              multiline
              swipeActions={[
                { label: t("绑定"), color: "rgb(var(--ios-gray))", onAction: () => onOpenBindings(row) },
                { label: t("删除"), color: "rgb(var(--ios-red))", onAction: () => onDelete(row) },
              ]}
              onContextMenu={(event) => {
                event.preventDefault();
                setMenu({ id: row.id, x: event.clientX, y: event.clientY });
              }}
              title={<span className="font-semibold">{row.name || row.id}</span>}
              subtitle={
                <>
                  <span className="font-mono">{row.addr}</span>
                  <br />
                  {t("SIM / Profile 绑定")} {row.bindingCount}
                  {row.countryNames.length ? ` · ${row.countryNames.join("、")}` : ""}
                </>
              }
              accessory={
                <span className="flex shrink-0 items-center gap-1" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    aria-label={t("更多操作")}
                    title={t("更多操作")}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-full text-accent hover:bg-fill-4 [&_svg]:h-5 [&_svg]:w-5"
                    onClick={(event) => {
                      const rect = event.currentTarget.getBoundingClientRect();
                      setMenu({ id: row.id, x: rect.right, y: rect.bottom });
                    }}
                  >
                    <MoreHorizontalRegular />
                  </button>
                  <IOSSwitch checked={row.enabled} disabled={toggleBusyId === row.id} onChange={() => onToggle(row)} ariaLabel={row.enabled ? t("禁用") : t("启用")} />
                </span>
              }
            />
          ))}
        </ListSection>
      )}
      <ContextMenu
        open={Boolean(menuRow)}
        anchor={menu}
        onClose={() => setMenu(null)}
        title={menuRow?.name || menuRow?.id}
        items={menuRow ? [
          { label: t("编辑"), icon: <EditRegular />, onSelect: () => onEdit(menuRow) },
          { label: t("SIM / Profile 绑定"), icon: <DesktopRegular />, onSelect: () => onOpenBindings(menuRow) },
          { label: t("删除"), icon: <DeleteRegular />, destructive: true, onSelect: () => onDelete(menuRow) },
        ] : []}
      />
    </>
  );
}
