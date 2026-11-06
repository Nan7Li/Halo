import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowDownloadRegular,
  CallFilled,
  CallInboundRegular,
  CallMissedRegular,
  CallOutboundRegular,
  CopyRegular,
  DialpadRegular,
  HeadphonesRegular,
  InfoRegular,
} from "@fluentui/react-icons";
import { api } from "../api";
import { useI18n } from "../lib/i18n";
import { useMediaQuery } from "../lib/useMediaQuery";
import { cx } from "../lib/utils";
import type { CallRecord, CallRecordsResponse } from "../types";
import { message } from "../components/ui";
import { BarButton, ContentUnavailable, ListSection, Page, SegmentedControl, Sheet } from "../components/ios";
import { CellBridgeSettings } from "../components/devices/CellBridgeSettings";
import { Keypad } from "../components/phone/Keypad";
import { useCalls } from "../components/phone/CallProvider";
import { formatDuration, formatNumber, formatRecentTime, isLive, lineReady } from "../components/phone/model";

type Section = "recents" | "keypad";
type Filter = "all" | "missed";

/**
 * iOS Phone: Recents and Keypad. On wide screens both are visible side by
 * side. The call itself is presented by the global CallProvider.
 */
export default function PhonePage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const params = useParams();
  const wide = useMediaQuery("(min-width: 1100px)");
  const section: Section = params.section === "keypad" ? "keypad" : "recents";
  const calls = useCalls();
  const { lines, linesLoaded, current, busy, dial, historyVersion } = calls;
  const [lineId, setLineId] = useState("");
  const [number, setNumber] = useState("");
  const [records, setRecords] = useState<CallRecord[]>([]);
  const [recordsLoaded, setRecordsLoaded] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [detail, setDetail] = useState<CallRecord | null>(null);
  const [bridgeOpen, setBridgeOpen] = useState(false);

  // Prefer a line that can call right now.
  useEffect(() => {
    if (lineId && lines.some((line) => line.id === lineId)) return;
    const preferred = lines.find(lineReady) || lines.find((line) => line.vowifiEnabled && line.running) || lines[0];
    if (preferred) setLineId(preferred.id);
  }, [lines, lineId]);

  const loadRecords = useCallback(async () => {
    try {
      const result = await api<CallRecordsResponse>("/calls/history?limit=200");
      setRecords(result?.records || []);
    } catch {
      /* history is auxiliary */
    } finally {
      setRecordsLoaded(true);
    }
  }, []);

  useEffect(() => {
    void loadRecords();
    const timer = window.setInterval(() => void loadRecords(), 15_000);
    return () => window.clearInterval(timer);
  }, [loadRecords, historyVersion]);

  const visible = useMemo(() => (filter === "missed" ? records.filter((record) => record.state === "missed") : records), [records, filter]);
  const missedCount = useMemo(() => records.filter((record) => record.state === "missed").length, [records]);

  const callNumber = async (target: string, preferredLine?: string) => {
    const value = target.trim();
    if (!value) return;
    const candidates = [preferredLine, lineId].filter(Boolean) as string[];
    const chosen = candidates.map((id) => lines.find((line) => line.id === id)).find((line) => line && lineReady(line)) || lines.find(lineReady);
    if (!chosen || (current && isLive(current))) {
      // Nothing can call right now: put the number on the keypad instead.
      setNumber(value);
      if (preferredLine) setLineId(preferredLine);
      navigate("/phone/keypad");
      if (!chosen) message.warning(t("当前没有可用线路，号码已填入拨号键盘"));
      return;
    }
    await dial(chosen.id, value);
  };

  const trailing = (
    <>
      <BarButton icon={<HeadphonesRegular />} aria-label={t("通话桥设置")} title={t("通话桥设置")} onClick={() => setBridgeOpen(true)} />
      {!wide && section === "recents" ? (
        <BarButton icon={<DialpadRegular />} aria-label={t("拨号键盘")} onClick={() => navigate("/phone/keypad")} />
      ) : null}
    </>
  );

  const keypad = (
    <Keypad
      number={number}
      onNumber={setNumber}
      lines={lines}
      lineId={lineId}
      onLine={setLineId}
      onCall={() => void dial(lineId, number)}
      busy={busy}
      inCall={Boolean(current && isLive(current))}
    />
  );

  const recents = (
    <div>
      <div className="mb-4 flex justify-center lg:justify-start">
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: t("全部") },
            { value: "missed", label: missedCount ? `${t("未接")} · ${missedCount}` : t("未接") },
          ]}
          className="w-full max-w-[280px]"
        />
      </div>
      {!recordsLoaded ? null : visible.length === 0 ? (
        <ContentUnavailable
          icon={<CallFilled />}
          title={filter === "missed" ? t("没有未接来电") : t("没有最近通话")}
          description={t("通过 Wi-Fi Calling 或通话桥拨打和接听的电话会显示在这里。")}
        />
      ) : (
        <ListSection>
          {visible.map((record) => (
            <RecentRow key={record.id} record={record} lineName={lineLabel(record.deviceId)} onCall={() => void callNumber(record.number, record.deviceId)} onInfo={() => setDetail(record)} />
          ))}
        </ListSection>
      )}
    </div>
  );

  function lineLabel(id: string) {
    const line = lines.find((item) => item.id === id);
    return line?.name || id;
  }

  const noLines = linesLoaded && lines.length === 0;

  return (
    <Page
      title={!wide && section === "keypad" ? t("拨号键盘") : t("电话")}
      trailing={trailing}
      largeTitle={wide || section === "recents"}
      accessory={
        !wide ? (
          <SegmentedControl<Section>
            pill
            block
            value={section}
            onChange={(next) => navigate(next === "keypad" ? "/phone/keypad" : "/phone")}
            options={[
              { value: "recents", label: t("最近通话") },
              { value: "keypad", label: t("拨号键盘") },
            ]}
          />
        ) : undefined
      }
    >
      {noLines ? (
        <ContentUnavailable
          icon={<CallFilled />}
          title={t("还没有电话线路")}
          description={t("先在「设备」中添加模组并开启 VoWiFi，或配置大疆蜂窝通话桥。")}
          action={<BarButton prominent label={t("前往设备")} onClick={() => navigate("/devices")} />}
        />
      ) : wide ? (
        <div className="grid grid-cols-[360px_minmax(0,1fr)] items-start gap-8">
          <div className="ios-card sticky top-16 px-5 py-6">{keypad}</div>
          {recents}
        </div>
      ) : section === "keypad" ? (
        <div className="ios-push pt-2">{keypad}</div>
      ) : (
        <div className="ios-push">{recents}</div>
      )}

      <RecordSheet record={detail} lineName={detail ? lineLabel(detail.deviceId) : ""} onClose={() => setDetail(null)} onCall={(record) => { setDetail(null); void callNumber(record.number, record.deviceId); }} />
      <Sheet open={bridgeOpen} onClose={() => setBridgeOpen(false)} title={t("通话桥")} width="md:max-w-[680px]" solid>
        <CellBridgeSettings devices={lines} />
      </Sheet>
    </Page>
  );
}

function directionIcon(record: CallRecord) {
  if (record.state === "missed") return <CallMissedRegular />;
  return record.direction === "incoming" ? <CallInboundRegular /> : <CallOutboundRegular />;
}

function RecentRow({ record, lineName, onCall, onInfo }: { record: CallRecord; lineName: string; onCall: () => void; onInfo: () => void }) {
  const { t } = useI18n();
  const missed = record.state === "missed";
  const failed = record.state === "failed";
  const duration = formatDuration(record.durationSeconds);
  return (
    <div className="ios-row">
      <span className={cx("inline-flex h-5 w-5 shrink-0 items-center justify-center text-label-3 [&_svg]:h-[18px] [&_svg]:w-[18px]", missed && "text-sys-red")}>{directionIcon(record)}</span>
      <div className="ios-row-body">
        <button type="button" onClick={onCall} disabled={!record.number} className="min-w-0 flex-1 text-left">
          <span className={cx("block truncate ios-headline", missed || failed ? "text-sys-red" : "text-label")}>
            {formatNumber(record.number) || t("未知号码")}
          </span>
          <span className="mt-0.5 block truncate ios-footnote text-label-2">
            {record.transport === "cellular" ? t("蜂窝") : "Wi-Fi Calling"} · {lineName}
            {duration ? ` · ${duration}` : ""}
            {record.recording ? ` · ${t("有录音")}` : ""}
          </span>
        </button>
        <span className="shrink-0 ios-subhead text-label-2">{t(formatRecentTime(record.startedAt))}</span>
        <button type="button" aria-label={t("详细信息")} onClick={onInfo} className="-mr-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-accent hover:bg-fill-4">
          <InfoRegular className="h-[22px] w-[22px]" />
        </button>
      </div>
    </div>
  );
}

function RecordSheet({ record, lineName, onClose, onCall }: { record: CallRecord | null; lineName: string; onClose: () => void; onCall: (record: CallRecord) => void }) {
  const { t } = useI18n();
  const [shown, setShown] = useState<CallRecord | null>(record);
  useEffect(() => {
    if (record) setShown(record);
  }, [record]);
  const item = record ?? shown;
  const stateLabel: Record<CallRecord["state"], string> = {
    answered: t("已接通"),
    missed: t("未接来电"),
    failed: t("呼叫失败"),
    active: t("进行中"),
    ended: t("已结束"),
  };
  return (
    <Sheet open={Boolean(record)} onClose={onClose} title={t("通话详情")} solid>
      {item ? (
        <div className="pb-2">
          <div className="flex flex-col items-center pb-5 pt-2 text-center">
            <span className="ios-avatar mb-3 h-20 w-20 text-[34px]">
              <CallFilled className="h-9 w-9" />
            </span>
            <div className="ios-title-2 text-label">{formatNumber(item.number) || t("未知号码")}</div>
            <div className="mt-1 ios-subhead text-label-2">{lineName}</div>
            <div className="mt-4 grid w-full max-w-xs grid-cols-2 gap-3">
              <button type="button" disabled={!item.number} onClick={() => onCall(item)} className="flex flex-col items-center gap-1 rounded-2xl bg-grouped-2 py-3 text-accent ios-press disabled:opacity-40">
                <CallFilled className="h-6 w-6" />
                <span className="ios-caption font-semibold">{t("呼叫")}</span>
              </button>
              <button
                type="button"
                disabled={!item.number}
                onClick={() => {
                  void navigator.clipboard?.writeText(item.number).then(() => message.success(t("号码已复制")));
                }}
                className="flex flex-col items-center gap-1 rounded-2xl bg-grouped-2 py-3 text-accent ios-press disabled:opacity-40"
              >
                <CopyRegular className="h-6 w-6" />
                <span className="ios-caption font-semibold">{t("复制")}</span>
              </button>
            </div>
          </div>
          <ListSection header={new Date(item.startedAt || "").toLocaleDateString([], { year: "numeric", month: "long", day: "numeric", weekday: "long" })}>
            <div className="ios-row">
              <div className="ios-row-body">
                <span className="ios-body text-label">{new Date(item.startedAt || "").toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                <span className="flex-1 ios-body text-label-2">
                  {item.direction === "incoming" ? t("呼入") : t("呼出")} · {stateLabel[item.state]}
                </span>
                <span className="ios-body text-label-2">{formatDuration(item.durationSeconds) || "—"}</span>
              </div>
            </div>
            <div className="ios-row">
              <div className="ios-row-body">
                <span className="flex-1 ios-body text-label">{t("线路")}</span>
                <span className="ios-body text-label-2">{item.transport === "cellular" ? t("蜂窝") : "Wi-Fi Calling"}</span>
              </div>
            </div>
          </ListSection>
          {item.recording ? (
            <ListSection header={t("录音")}>
              <div className="flex flex-col gap-3 p-4">
                <audio controls preload="none" className="w-full" src={`/api/calls/history/${item.id}/recording`} />
                <a href={`/api/calls/history/${item.id}/recording`} download className="inline-flex items-center gap-1.5 self-start ios-subhead font-semibold text-accent">
                  <ArrowDownloadRegular className="h-4 w-4" />
                  {t("下载录音")}
                </a>
              </div>
            </ListSection>
          ) : null}
        </div>
      ) : null}
    </Sheet>
  );
}
