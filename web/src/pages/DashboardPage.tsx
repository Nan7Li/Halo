import { useCallback, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownRegular, ArrowUpRegular, ClockRegular, GlobeRegular, RouterRegular, ServerRegular, SendClockRegular } from "@fluentui/react-icons";
import { api } from "../api";
import type { DashboardDevice, DashboardHost, DashboardUpcomingTask } from "../types";
import { usePolling } from "../lib/usePolling";
import { useI18n } from "../lib/i18n";
import { cx } from "../lib/utils";
import { ErrorState } from "../components/ui/ErrorState";
import { ListSkeleton } from "../components/ui/ListSkeleton";
import { BarButton, ContentUnavailable, ListRow, ListSection, Page } from "../components/ios";
import { ArrowSyncRegular } from "@fluentui/react-icons";

interface LoadError { message: string; status?: number }

const UPCOMING_TASK_COUNT = 3;
const TASKS_POLL_INTERVAL = 15000;

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatRate(bps: number) {
  return `${formatBytes(bps)}/s`;
}

/** Overview as iOS widgets: lines, host activity rings, network, tasks, devices. */
export default function DashboardPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [devices, setDevices] = useState<DashboardDevice[]>([]);
  const [devicesLoading, setDevicesLoading] = useState(false);
  const [devicesError, setDevicesError] = useState<LoadError | null>(null);
  const [devicesOkAt, setDevicesOkAt] = useState<number | null>(null);
  const [host, setHost] = useState<DashboardHost | null>(null);
  const [upcomingTasks, setUpcomingTasks] = useState<DashboardUpcomingTask[]>([]);

  const fetchDevices = useCallback(async () => {
    setDevicesLoading(true);
    try {
      const list = await api<DashboardDevice[]>("/dashboard/devices");
      setDevices(Array.isArray(list) ? list : []);
      setDevicesError(null);
      setDevicesOkAt(Date.now());
    } catch (e: unknown) {
      const error = e as { message?: string; status?: number };
      setDevicesError({ message: error?.message || t("加载失败"), status: error?.status });
    } finally {
      setDevicesLoading(false);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const fetchHost = useCallback(async () => {
    try {
      setHost(await api<DashboardHost>("/dashboard/host"));
    } catch {
      /* keep the last good sample */
    }
  }, []);

  const fetchUpcomingTasks = useCallback(async () => {
    try {
      const data = await api<{ tasks?: DashboardUpcomingTask[] }>("/automatic-tasks");
      setUpcomingTasks(
        (data.tasks || [])
          .filter((task) => task.enabled && task.nextRunAt && !task.nextRunAt.startsWith("0001-"))
          .sort((a, b) => new Date(a.nextRunAt).getTime() - new Date(b.nextRunAt).getTime())
          .slice(0, UPCOMING_TASK_COUNT),
      );
    } catch {
      /* keep the last list */
    }
  }, []);

  usePolling(fetchDevices, 5000);
  usePolling(fetchHost, 2000);
  usePolling(fetchUpcomingTasks, TASKS_POLL_INTERVAL);

  const total = devices.length;
  const online = devices.filter((device) => device?.healthy).length;
  const vowifi = devices.filter((device) => device?.vowifiRuntime?.imsReady).length;
  const perf = host?.perf;
  const today = new Date().toLocaleDateString([], { month: "long", day: "numeric", weekday: "long" });

  return (
    <Page
      title={t("概览")}
      subtitle={today}
      trailing={<BarButton icon={<ArrowSyncRegular className={cx(devicesLoading && "animate-spin")} />} aria-label={t("刷新")} onClick={() => void fetchDevices()} />}
    >
      <div className="mb-8 grid grid-cols-2 gap-3 md:grid-cols-4 md:gap-4">
        <Widget title={t("线路")} icon={<RouterRegular />} tint="green">
          <div className="flex items-end gap-1">
            <span className="ios-widget-value text-label">{online}</span>
            <span className="mb-1 ios-title-3 font-medium text-label-3">/ {total}</span>
          </div>
          <div className="mt-2 ios-footnote text-label-2">{t("在线")} · {vowifi} {t("条 IMS 就绪")}</div>
          <Meter value={total ? online / total : 0} tint="green" />
        </Widget>

        <Widget title={t("即将执行")} icon={<SendClockRegular />} tint="orange" onClick={() => navigate("/automatic-tasks")}>
          {upcomingTasks.length ? (
            <ul className="space-y-1.5">
              {upcomingTasks.map((task) => (
                <li key={task.id} className="flex min-w-0 items-center gap-2">
                  <span className="h-[18px] w-1 shrink-0 rounded-full bg-sys-orange" />
                  <span className="min-w-0 flex-1 truncate ios-subhead font-medium text-label">{task.name}</span>
                  <span className="shrink-0 ios-caption tabular-nums text-label-2">
                    {new Date(task.nextRunAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex items-center gap-2 pt-1 ios-footnote text-label-2">
              <ClockRegular className="h-4 w-4" />
              {t("没有计划中的任务")}
            </div>
          )}
        </Widget>

        <Widget title={t("主机")} icon={<ServerRegular />} tint="blue" wide>
          <div className="flex items-center gap-3">
            <Rings values={[perf?.cpuPercent ?? 0, perf?.memoryPercent ?? 0, perf?.diskPercent ?? 0]} />
            <div className="min-w-0 space-y-0.5 ios-footnote">
              <RingLegend color="var(--ring-1)" label="CPU" value={perf ? `${perf.cpuPercent.toFixed(0)}%` : "—"} />
              <RingLegend color="var(--ring-2)" label={t("内存")} value={perf ? `${perf.memoryPercent.toFixed(0)}%` : "—"} />
              <RingLegend color="var(--ring-3)" label={t("磁盘")} value={perf ? `${perf.diskPercent.toFixed(0)}%` : "—"} />
            </div>
          </div>
        </Widget>

        <Widget title={t("网络")} icon={<GlobeRegular />} tint="teal" wide>
          <div className="space-y-2">
            <RateLine icon={<ArrowDownRegular />} label={t("下载")} value={perf ? formatRate(perf.netRxBps) : "—"} tint="teal" />
            <RateLine icon={<ArrowUpRegular />} label={t("上传")} value={perf ? formatRate(perf.netTxBps) : "—"} tint="blue" />
          </div>
          {perf ? (
            <div className="mt-3 ios-caption text-label-2">
              {t("内存")} {formatBytes(perf.memoryUsedBytes)} / {formatBytes(perf.memoryTotalBytes)}
            </div>
          ) : null}
        </Widget>

      </div>

      {devicesError ? (
        <ErrorState className="mb-6" title={t("设备列表加载失败")} message={devicesError.message} statusCode={devicesError.status} lastSuccessAt={devicesOkAt} retryText={t("重试")} onRetry={fetchDevices} />
      ) : null}

      {devicesLoading && devices.length === 0 ? (
        <ListSkeleton rows={4} />
      ) : devices.length === 0 ? (
        <ContentUnavailable
          icon={<RouterRegular />}
          title={t("暂无设备接入")}
          description={t("请先在设备管理中添加或接管设备")}
          action={<BarButton prominent label={t("添加设备")} onClick={() => navigate("/devices")} />}
        />
      ) : (
        <ListSection header={t("设备")} prominent>
          {devices.map((device) => (
            <ListRow
              key={device.id}
              to={`/devices?device=${encodeURIComponent(device.id)}&tab=overview`}
              icon={<RouterRegular />}
              iconColor={device.healthy ? "green" : "gray"}
              title={device.name || device.id}
              subtitle={[device.operator || t("无服务"), device.networkMode, device.publicIp].filter(Boolean).join(" · ")}
              accessory={
                <span className="flex shrink-0 items-center gap-2">
                  {device.vowifiRuntime?.imsReady ? <span className="rounded-full bg-sys-green/15 px-2 py-0.5 ios-caption-2 font-semibold text-sys-green">Wi-Fi Calling</span> : null}
                  <SignalBars dbm={device.healthy ? device.signalDbm : 0} />
                </span>
              }
            />
          ))}
        </ListSection>
      )}
    </Page>
  );
}

/** iOS widget. `wide` makes it a medium widget (two columns) on phones. */
function Widget({ title, icon, tint, children, onClick, wide }: { title: string; icon: ReactNode; tint: string; children: ReactNode; onClick?: () => void; wide?: boolean }) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cx("ios-widget flex min-w-0 flex-col text-left", wide ? "col-span-2 md:col-span-1" : "min-h-[150px]", onClick && "ios-press")}
    >
      <div className="mb-3 flex items-center gap-1.5 ios-footnote font-semibold" style={{ color: `rgb(var(--ios-${tint}))` }}>
        <span className="inline-flex [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
        {title}
      </div>
      <div className={cx("flex min-h-0 flex-1 flex-col", wide ? "justify-center" : "justify-end")}>{children}</div>
    </Tag>
  );
}

function Meter({ value, tint }: { value: number; tint: string }) {
  return (
    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-fill-3">
      <div
        className="h-full rounded-full transition-[width] duration-[var(--dur-spring-smooth)] ease-spring"
        style={{ width: `${Math.round(Math.min(1, Math.max(0, value)) * 100)}%`, background: `rgb(var(--ios-${tint}))` }}
      />
    </div>
  );
}

/** Concentric activity rings (CPU, memory, disk). */
function Rings({ values }: { values: number[] }) {
  const size = 78;
  const stroke = 9;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0 -rotate-90 [--ring-1:rgb(var(--ios-pink))] [--ring-2:rgb(var(--ios-green))] [--ring-3:rgb(var(--ios-cyan))]" aria-hidden>
      {values.map((value, index) => {
        const radius = size / 2 - stroke / 2 - index * (stroke + 1.5);
        const circumference = 2 * Math.PI * radius;
        const color = `var(--ring-${index + 1})`;
        return (
          <g key={index}>
            <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeOpacity={0.2} strokeWidth={stroke} />
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={circumference * (1 - Math.min(100, Math.max(0, value)) / 100)}
              style={{ transition: "stroke-dashoffset var(--dur-spring-smooth) var(--spring-smooth)" }}
            />
          </g>
        );
      })}
    </svg>
  );
}

function RingLegend({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-1.5 [--ring-1:rgb(var(--ios-pink))] [--ring-2:rgb(var(--ios-green))] [--ring-3:rgb(var(--ios-cyan))]">
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
      <span className="whitespace-nowrap text-label-2">{label}</span>
      <span className="ml-auto font-semibold tabular-nums text-label">{value}</span>
    </div>
  );
}

function RateLine({ icon, label, value, tint }: { icon: ReactNode; label: string; value: string; tint: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full [&_svg]:h-3.5 [&_svg]:w-3.5" style={{ background: `rgb(var(--ios-${tint}) / 0.15)`, color: `rgb(var(--ios-${tint}))` }}>
        {icon}
      </span>
      <span className="whitespace-nowrap ios-footnote text-label-2">{label}</span>
      <span className="ml-auto whitespace-nowrap ios-headline tabular-nums text-label">{value}</span>
    </div>
  );
}

/** Four cellular bars from RSRP/RSSI dBm. */
function SignalBars({ dbm }: { dbm: number }) {
  const level = !dbm ? 0 : dbm >= -85 ? 4 : dbm >= -95 ? 3 : dbm >= -105 ? 2 : 1;
  return (
    <span className="flex h-3.5 items-end gap-[2px]" title={dbm ? `${dbm} dBm` : undefined} aria-label={`${level}/4`}>
      {[1, 2, 3, 4].map((bar) => (
        <span key={bar} className={cx("w-[3px] rounded-[1px]", bar <= level ? "bg-label" : "bg-label-4")} style={{ height: `${bar * 25}%` }} />
      ))}
    </span>
  );
}
