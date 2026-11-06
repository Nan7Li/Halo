import { useState } from "react";
import { CheckmarkRegular, FilterRegular } from "@fluentui/react-icons";
import type { DeviceListItem } from "../../types";
import { ListSkeleton } from "../ui";
import { ContentUnavailable, ContextMenu, ListRow, ListSection, SearchField } from "../ios";
import { deviceStatusMeta, isDeviceOnline, isRegistered, isVoWiFiInUse, lifecycleLabel } from "./shared";
import { deviceTypeImage } from "../../lib/deviceTypes";
import { tl, useI18n } from "../../lib/i18n";
import { cx } from "../../lib/utils";

export type StatusFilter = "all" | "online" | "offline";
export type SortKey = "name" | "signal";
export type SortDir = "asc" | "desc";

export interface DeviceListPanelProps {
  loading: boolean;
  query: string;
  statusFilter: StatusFilter;
  sortKey: SortKey;
  sortDir: SortDir;
  selectedId: string;
  filteredDevices: DeviceListItem[];
  deviceCount: number;
  deviceLimit: number;
  /** Highlight the selected row (split view); phones push instead. */
  showSelection?: boolean;
  onQueryChange: (v: string) => void;
  onStatusFilterChange: (v: StatusFilter) => void;
  onSortKeyChange: (v: SortKey) => void;
  onSortDirChange: (v: SortDir) => void;
  onSelectDevice: (id: string) => void;
}

function primaryLine(d: DeviceListItem): string {
  const phaseLabel = lifecycleLabel(d.lifecyclePhase);
  if (phaseLabel && d.lifecyclePhase !== "online" && d.lifecyclePhase !== "offline") return phaseLabel;
  if (isRegistered(d)) {
    const operator = d.modem?.operator || "--";
    const mode = [d.modem?.networkDuplex, d.modem?.networkMode].filter(Boolean).join(" ") || "--";
    return `${operator} · ${mode}`;
  }
  if (isDeviceOnline(d)) {
    return d.registrationStateLabel === "searching" ? tl("搜索网络中") : d.registrationStateLabel === "denied" ? tl("驻网被拒") : tl("未驻网");
  }
  return tl("控制面恢复中");
}

function statusLine(d: DeviceListItem): string {
  if (isVoWiFiInUse(d)) return "Wi-Fi Calling";
  return primaryLine(d);
}

const TONE: Record<string, string> = { success: "text-sys-green", warning: "text-sys-orange", danger: "text-sys-red" };

/**
 * Device list in iOS style: search field and a filter menu above an inset
 * grouped list. Filtering and sorting live in one menu, like Mail's filter
 * button, instead of three dropdowns.
 */
export function DeviceListPanel(props: DeviceListPanelProps) {
  const { t } = useI18n();
  const { loading, query, statusFilter, sortKey, sortDir, selectedId, filteredDevices, deviceCount, deviceLimit, showSelection } = props;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const filtered = statusFilter !== "all" || sortKey !== "name" || sortDir !== "asc";
  const check = (on: boolean) => (on ? <CheckmarkRegular /> : <span className="inline-block w-[18px]" />);

  return (
    <div className="min-w-0">
      <div className="mb-4 flex items-center gap-2">
        <SearchField value={query} onChange={props.onQueryChange} placeholder={t("搜索设备 / ICCID / IMEI / 网卡")} className="min-w-0 flex-1" />
        <button
          type="button"
          aria-label={t("筛选与排序")}
          title={t("筛选与排序")}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.right, y: rect.bottom });
          }}
          className={cx(
            "ios-search-chip inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors [&_svg]:h-5 [&_svg]:w-5",
            filtered ? "bg-accent text-[var(--color-on-primary)]" : "bg-fill-3 text-label",
          )}
        >
          <FilterRegular />
        </button>
      </div>
      <ContextMenu
        open={Boolean(menu)}
        anchor={menu}
        onClose={() => setMenu(null)}
        title={t("筛选与排序")}
        items={[
          { label: t("全部设备"), icon: check(statusFilter === "all"), onSelect: () => props.onStatusFilterChange("all") },
          { label: t("仅在线"), icon: check(statusFilter === "online"), onSelect: () => props.onStatusFilterChange("online") },
          { label: t("仅离线"), icon: check(statusFilter === "offline"), onSelect: () => props.onStatusFilterChange("offline") },
          { label: t("按名称排序"), icon: check(sortKey === "name"), onSelect: () => props.onSortKeyChange("name") },
          { label: t("按信号排序"), icon: check(sortKey === "signal"), onSelect: () => props.onSortKeyChange("signal") },
          { label: sortDir === "asc" ? t("改为降序") : t("改为升序"), onSelect: () => props.onSortDirChange(sortDir === "asc" ? "desc" : "asc") },
        ]}
      />
      {loading && filteredDevices.length === 0 ? (
        <ListSkeleton rows={4} />
      ) : filteredDevices.length === 0 ? (
        <ContentUnavailable
          title={query ? t("无结果") : t("暂无设备")}
          description={query ? undefined : t("点击右上角 + 开始接管设备")}
        />
      ) : (
        <ListSection footer={deviceLimit > 0 ? `${t("已使用配额")} ${deviceCount} / ${deviceLimit}` : undefined}>
          {filteredDevices.map((device) => {
            const meta = deviceStatusMeta(device);
            const selected = showSelection && selectedId === device.id;
            return (
              <ListRow
                key={device.id}
                onClick={() => props.onSelectDevice(device.id)}
                chevron={!showSelection}
                className={cx(selected && "is-selected")}
                leading={
                  <span className="ios-row-thumb">
                    <img src={deviceTypeImage(device.deviceType)} alt="" />
                  </span>
                }
                title={<span className="font-semibold">{device.name || device.id}</span>}
                subtitle={statusLine(device)}
                accessory={
                  <span className={cx("flex shrink-0 items-center gap-1.5 ios-footnote font-medium", TONE[meta.tone] ?? "text-label-2")}>
                    <span className={cx("h-2 w-2 rounded-full bg-current", meta.animated && "animate-pulse")} />
                    {meta.label}
                  </span>
                }
              />
            );
          })}
        </ListSection>
      )}
    </div>
  );
}
