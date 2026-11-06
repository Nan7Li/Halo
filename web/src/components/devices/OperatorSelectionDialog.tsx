import { useEffect, useRef, useState } from "react";
import { api, apiMessage } from "../../api";
import { cx } from "../../lib/utils";
import { Modal, Spinner, Switch, message } from "../ui";
import { ListSection } from "../ios";
import { readEventStream } from "./shared";
import { CandidateRow } from "./CandidateRow";
import type { OperatorCandidate } from "./types";
import { tf, useI18n } from "../../lib/i18n";

interface ScanState {
  scanId?: string;
  status?: string;
  candidates?: OperatorCandidate[];
  message?: string;
  error?: string;
  retryable?: boolean;
}
interface CurrentSelection {
  mode?: string;
  plmn?: string;
}

function ratsText(c: OperatorCandidate): string {
  const list = (c.rats || []).filter(Boolean) as string[];
  return list.length ? list.map((r) => r.toUpperCase()).join(" / ") : "--";
}
function firstRat(c: OperatorCandidate): string | undefined {
  return (c.rats || []).find((r) => !!r) || undefined;
}

export interface OperatorSelectionDialogProps {
  open: boolean;
  deviceId: string;
  scanBlockedReason?: string;
  onClose: () => void;
  onUpdated: () => void;
}

export function OperatorSelectionDialog({ open, deviceId, scanBlockedReason = "", onClose, onUpdated }: OperatorSelectionDialogProps) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [current, setCurrent] = useState<CurrentSelection | null>(null);
  const [scan, setScan] = useState<ScanState | null>(null);
  const [registering, setRegistering] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const registerAbortRef = useRef<AbortController | null>(null);
  const scanInFlightRef = useRef(false);
  const notifiedRef = useRef("");

  const scanning = scan?.status === "running";
  const candidates = scan?.candidates || [];
  const scanMessage = scan?.message || scanBlockedReason;
  const errorText = scan?.retryable ? "" : scan?.error || "";
  const retryable = !!scan?.retryable || !!scanBlockedReason;
  function stopStream() {
    abortRef.current?.abort();
    abortRef.current = null;
    scanInFlightRef.current = false;
  }

  async function loadCurrent() {
    if (!deviceId) return;
    setBusy(true);
    try {
      const data = await api<CurrentSelection>(`/devices/${deviceId}/operator_selection`);
      setCurrent(data || null);
    } catch (e) {
      message.error(apiMessage(e) || t("加载当前配置失败"));
    } finally {
      setBusy(false);
    }
  }

  function startStream() {
    if (!deviceId || scanInFlightRef.current) return;
    if (scanBlockedReason) {
      setScan({ status: "blocked", message: scanBlockedReason, retryable: true });
      return;
    }
    stopStream();
    const controller = new AbortController();
    abortRef.current = controller;
    scanInFlightRef.current = true;
    setScan({ status: "running", message: t("正在请求模组扫描可用网络...") });
    readEventStream(
      `/devices/${deviceId}/operator_selection/scan/stream`,
      {},
      {
        signal: controller.signal,
        onEvent: (event, data) => {
          if (event !== "operator_scan") return;
          try {
            const parsed = JSON.parse(data) as ScanState;
            setScan(parsed);
            if (parsed.status !== "running") stopStream();
          } catch {
            /* ignore */
          }
        },
      },
    ).catch((e) => {
      scanInFlightRef.current = false;
      if (!controller.signal.aborted) message.error(apiMessage(e) || t("扫描网络失败"));
    });
  }

  async function restoreAuto() {
    const controller = new AbortController();
    registerAbortRef.current = controller;
    setRegistering(t("正在恢复自动选网..."));
    setBusy(true);
    try {
      await api(`/devices/${deviceId}/operator_selection`, { method: "POST", body: { mode: "automatic" }, signal: controller.signal });
      message.success(t("已恢复自动选网"));
      onUpdated();
      await loadCurrent();
    } catch (e) {
      if (controller.signal.aborted) message.info(t("已取消"));
      else message.error(apiMessage(e) || t("设置失败"));
    } finally {
      setRegistering(null);
      registerAbortRef.current = null;
      setBusy(false);
    }
  }

  async function reRegister() {
	const controller = new AbortController();
	registerAbortRef.current = controller;
	setRegistering(t("正在按当前选网配置重新驻网，请稍候..."));
	setBusy(true);
	try {
	  await api(`/devices/${deviceId}/operator_selection/reregister`, { method: "POST", signal: controller.signal });
	  message.success(t("已重新发起驻网"));
	  onUpdated();
	  await loadCurrent();
	} catch (e) {
	  if (controller.signal.aborted) message.info(t("已取消"));
	  else message.error(apiMessage(e) || t("重新驻网失败"));
	} finally {
	  setRegistering(null);
	  registerAbortRef.current = null;
	  setBusy(false);
	}
  }

  async function lock(c: OperatorCandidate) {
    const controller = new AbortController();
    registerAbortRef.current = controller;
    setRegistering(tf("正在注册到 {plmn}，请稍候（可能需要 1-2 分钟）...", { plmn: c.plmn }));
    setBusy(true);
    try {
      await api(`/devices/${deviceId}/operator_selection`, {
        method: "POST",
        body: { mode: "manual", plmn: c.plmn, includesPcsDigit: c.includesPcsDigit, rat: firstRat(c) },
        signal: controller.signal,
      });
      message.success(tf("已锁定网络 {plmn}", { plmn: c.plmn }));
      onUpdated();
      await loadCurrent();
    } catch (e) {
      if (controller.signal.aborted) message.info(t("已取消"));
      else message.error(apiMessage(e) || t("设置失败"));
    } finally {
      setRegistering(null);
      registerAbortRef.current = null;
      setBusy(false);
    }
  }

  function cancelRegister() {
    registerAbortRef.current?.abort();
  }

  useEffect(() => {
    if (open) {
      setScan(null);
      notifiedRef.current = "";
      loadCurrent();
    } else {
      stopStream();
      registerAbortRef.current?.abort();
      registerAbortRef.current = null;
      setRegistering(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, deviceId]);

  // Notify on scan completion transitions.
  useEffect(() => {
    if (!scan || !open) return;
    const key = `${scan.scanId}:${scan.status}`;
    if (key === notifiedRef.current) return;
    if (scan.status === "complete") message.success(t("运营商扫描完成"));
    notifiedRef.current = key;
  }, [scan, open]);

  useEffect(() => () => {
    stopStream();
    registerAbortRef.current?.abort();
  }, []);
  return (
    <Modal open={open} onClose={onClose} title={t("运营商网络选择")}>
      <div className="pt-1">
        <ListSection
          footer={current?.mode === "manual" ? t("关闭“自动”后，模组只会注册到下方选中的网络。") : undefined}
          bodyClassName="px-4"
        >
          <div className="ios-form-row items-center">
            <span className="min-w-0 flex-1 ios-body text-label">{t("自动")}</span>
            <Switch
              ariaLabel={t("恢复自动选网")}
              checked={current?.mode === "automatic"}
              disabled={busy || current?.mode === "automatic"}
              onChange={(on) => { if (on) void restoreAuto(); }}
            />
          </div>
          {current?.mode === "manual" ? (
            <div className="ios-form-row items-center">
              <span className="min-w-0 flex-1 ios-body text-label">{t("已锁定 PLMN")}</span>
              <span className="shrink-0 font-mono ios-body text-label-2">{current.plmn || "--"}</span>
            </div>
          ) : null}
        </ListSection>

        {registering ? (
          <div className="mb-7 flex items-center justify-between gap-3 rounded-[var(--radius-lg)] bg-grouped-2 px-4 py-3 ios-subhead text-label">
            <span className="flex min-w-0 items-center gap-2">
              <Spinner className="h-4 w-4 shrink-0" />
              <span className="min-w-0">{registering}</span>
            </span>
            <button type="button" onClick={cancelRegister} className="shrink-0 font-medium text-accent">{t("取消")}</button>
          </div>
        ) : null}

        <ListSection
          header={
            <span className="flex items-end justify-between gap-3">
              <span>{t("网络")}</span>
              <button type="button" className="ios-subhead font-medium text-accent disabled:opacity-40" onClick={startStream} disabled={busy || scanning || !!scanBlockedReason}>
                {scanning ? t("扫描中...") : t("扫描可用网络")}
              </button>
            </span>
          }
          footer={
            <>
              {!registering && (errorText || scanMessage) ? (
                <span className={cx("block", errorText ? "text-sys-red" : retryable ? "text-sys-orange" : "")}>{errorText || scanMessage}</span>
              ) : null}
              <span className="block">{t("扫描结果只代表模组在当前位置实际收到的运营商信号，不代表模组支持的全部运营商；禁用网络表示当前 SIM 不允许注册。")}</span>
            </>
          }
          bodyClassName={cx("max-h-[min(50vh,420px)] overflow-y-auto", (!!registering || busy) && "pointer-events-none opacity-60")}
        >
          {candidates.length > 0 ? (
            candidates.map((c) => <CandidateRow key={`${c.plmn}-${ratsText(c)}`} candidate={c} onLock={lock} />)
          ) : (
            <div className="flex items-center justify-center gap-2 px-4 py-5 text-center ios-subhead text-label-2">
              {scanning ? <><Spinner className="h-4 w-4 shrink-0" />{t("正在搜索周围网络，这可能需要 1-3 分钟...")}</> : t("点击“扫描可用网络”查看附近的运营商")}
            </div>
          )}
        </ListSection>

        <ListSection className="!mb-1">
          <button type="button" onClick={reRegister} disabled={busy} className="ios-select-row flex w-full items-center px-4 text-left ios-body text-accent disabled:opacity-40">
            {t("重新驻网")}
          </button>
        </ListSection>
      </div>
    </Modal>
  );
}
