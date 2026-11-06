import { useState } from "react";
import type { CellLockTarget } from "../../types";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { CheckmarkRegular } from "@fluentui/react-icons";
import { Button, Input, Modal } from "../ui";
import { ListSection } from "../ios";
import type { DeviceCellLockView } from "./useDeviceCellLock";

function cellTargetText(cell: CellLockTarget) {
  return `EARFCN ${cell.earfcn} / PCI ${cell.pci}`;
}

export function CellLockDialog({ cellLock }: { cellLock: DeviceCellLockView }) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<{ earfcn: string; pci: string } | null>(null);
  const { operation, status, cells, lockError, cellsError, readingStatus, readingCells } = cellLock;
  const prefill = status?.target;
  const { earfcn, pci } = draft ?? { earfcn: String(prefill?.earfcn ?? ""), pci: String(prefill?.pci ?? "") };
  function editDraft(update: Partial<{ earfcn: string; pci: string }>) {
    setDraft(current => ({ earfcn, pci, ...current, ...update }));
  }
  const busy = operation !== null;
  const earfcnValid = /^\d+$/.test(earfcn.trim()) && Number(earfcn) <= 262143;
  const pciValid = /^\d+$/.test(pci.trim()) && Number(pci) <= 503;
  const target = earfcnValid && pciValid ? { earfcn: Number(earfcn), pci: Number(pci) } : null;

  function renderStatus() {
    if (busy) return <span role="status">{operation === "locking" ? t("正在应用小区锁定配置...") : t("正在解除小区锁定...")}</span>;
    if (readingStatus) return <span>{t("正在读取硬件锁定配置...")}</span>;
    if (!status) return <span>{t("锁定状态未知")}</span>;
    return <span>{t(status.target ? "已配置锁定" : "未配置锁定")}</span>;
  }

  return (
    <Modal
      open
      onClose={cellLock.closeDialog}
      title={t("小区锁定")}
      showClose={!busy}
    >
      <div className="pt-1">
        <ListSection
          header={t("硬件锁定配置")}
          footer={
            <>
              {busy ? <span className="block">{t("正在等待硬件确认，请勿断开设备。")}</span> : null}
              <span className="block">{t("仅确认锁定配置，不保证已生效或驻网；部分固件需手动设置 LTE-only 或重启，操作可能中断联网。")}</span>
            </>
          }
          bodyClassName="px-4"
        >
          <div className="ios-form-row items-center">
            <span className="min-w-0 flex-1 ios-body text-label">{t("状态")}</span>
            <span className={cx("shrink-0 ios-body", status ? (status.target ? "text-sys-orange" : "text-sys-green") : "text-label-2")}>{renderStatus()}</span>
          </div>
          {status && status.target ? (
            <div className="ios-form-row items-center">
              <span className="min-w-0 flex-1 ios-body text-label">{t("已配置目标")}</span>
              <span className="shrink-0 font-mono ios-subhead text-label-2">{cellTargetText(status.target)}</span>
            </div>
          ) : null}
        </ListSection>
        {lockError ? (
          <div className="-mt-4 mb-7 rounded-[var(--radius-md)] bg-sys-red/10 px-4 py-3 ios-subhead text-sys-red" role="alert">
            <p className="whitespace-pre-wrap break-words">{lockError}</p>
          </div>
        ) : null}

        <ListSection
          header={
            <span className="flex items-end justify-between gap-3">
              <span>{cells ? (cells.neighborsStatus === "available" ? t("服务小区与邻区") : t("服务小区")) : t("小区列表")}</span>
              <button type="button" className="ios-subhead font-medium text-accent disabled:opacity-40" onClick={cellLock.readCells} disabled={busy || readingCells}>
                {readingCells ? t("正在读取…") : t("刷新")}
              </button>
            </span>
          }
          footer={
            <>
              {cellsError ? <span className="block text-sys-orange" role="status">{cellsError}</span> : null}
              {cells && cells.neighborsStatus !== "available" ? (
                <span className="block">{cells.neighborsStatus === "unsupported" ? t("邻区查询不受此模组或固件支持") : t("本次邻区查询不可用")}</span>
              ) : null}
            </>
          }
        >
          {!busy && cells?.items.length ? (
            cells.items.map((cell, index) => {
              const selected = target?.earfcn === cell.earfcn && target?.pci === cell.pci;
              const configured = status?.target?.earfcn === cell.earfcn && status?.target?.pci === cell.pci;
              return (
                <button
                  key={`${cell.source}-${cell.earfcn}-${cell.pci}-${index}`}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => editDraft({ earfcn: String(cell.earfcn), pci: String(cell.pci) })}
                  className="ios-select-row flex w-full items-center gap-3 pl-4 pr-4 text-left"
                >
                  <span className="ios-select-row-body flex min-w-0 flex-1 items-center gap-3 py-2.5">
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-2">
                        <span className="font-mono ios-body font-medium text-label">{cellTargetText(cell)}</span>
                        {configured ? <span className="ios-footnote text-sys-orange">{t("已配置锁定")}</span> : null}
                      </span>
                      <span className="mt-0.5 block ios-footnote text-label-2">
                        {cell.source === "serving" ? t("服务小区") : t("邻区")} · {cell.plmn || "--"} · LTE
                        {" · "}
                        {[
                          cell.rsrp !== undefined ? `RSRP ${cell.rsrp} dBm` : null,
                          cell.rsrq !== undefined ? `RSRQ ${cell.rsrq} dB` : null,
                          cell.rssi !== undefined ? `RSSI ${cell.rssi} dBm` : null,
                          cell.sinr !== undefined ? `SINR ${cell.sinr} dB` : null,
                        ].filter(Boolean).join(" · ") || t("没有可用的信号测量值")}
                      </span>
                    </span>
                    <span className="flex w-5 shrink-0 justify-center text-accent [&_svg]:h-5 [&_svg]:w-5">{selected ? <CheckmarkRegular /> : null}</span>
                  </span>
                </button>
              );
            })
          ) : (
            <div className="px-4 py-4 text-center ios-subhead text-label-2">
              {busy ? t("配置变更中，小区列表暂不显示。")
                : cells ? t("读取成功，但没有发现可用小区；仍可在下方手动输入目标。")
                : readingCells ? t("正在读取小区列表...")
                : t("小区列表不可用；仍可在下方手动输入目标。")}
            </div>
          )}
        </ListSection>

        <ListSection
          header={t("手动输入 EARFCN / PCI")}
          footer={
            ((earfcn.length > 0 && !earfcnValid) || (pci.length > 0 && !pciValid))
              ? <span className="text-sys-red">{t("请输入 0 到 262143 的整数 EARFCN，以及 0 到 503 的整数 PCI。")}</span>
              : t("EARFCN 为 0 到 262143，PCI 为 0 到 503；实际是否支持由模组固件决定。")
          }
          bodyClassName="px-4"
        >
          <div className="ios-form-row">
            <label className="ios-form-label" htmlFor="cell-lock-earfcn">EARFCN</label>
            <div className="ios-form-control">
              <Input id="cell-lock-earfcn" type="text" inputMode="numeric" autoComplete="off" value={earfcn} onChange={(event) => editDraft({ earfcn: event.target.value })} placeholder={t("输入 EARFCN")} disabled={busy} aria-invalid={earfcn.length > 0 && !earfcnValid} />
            </div>
          </div>
          <div className="ios-form-row">
            <label className="ios-form-label" htmlFor="cell-lock-pci">PCI</label>
            <div className="ios-form-control">
              <Input id="cell-lock-pci" type="text" inputMode="numeric" autoComplete="off" value={pci} onChange={(event) => editDraft({ pci: event.target.value })} placeholder={t("输入 PCI")} disabled={busy} aria-invalid={pci.length > 0 && !pciValid} />
            </div>
          </div>
        </ListSection>

        <div className="grid grid-cols-2 gap-3">
          <Button variant="danger" plain onClick={() => { editDraft({}); void cellLock.setCellLock(null); }} loading={operation === "unlocking"} disabled={busy || status?.target === null}>
            {t("解除锁定")}
          </Button>
          <Button variant="primary" onClick={() => { if (target) { editDraft({}); void cellLock.setCellLock(target); } }} loading={operation === "locking"} disabled={busy || !target}>
            {t("锁定此小区")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
