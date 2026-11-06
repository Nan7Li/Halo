import { useState } from "react";
import { DeleteRegular, MoreHorizontalRegular, RenameRegular, ShieldRegular } from "@fluentui/react-icons";
import { cx } from "../../lib/utils";
import { ContextMenu } from "../ios";
import { Button, Input, Tag } from "../ui";
import { EsimCardPolicyInline } from "./EsimCardPolicyInline";
import type { EsimProfileItem } from "./types";
import { useI18n } from "../../lib/i18n";

export interface EsimProfileRowProps {
  deviceId: string;
  deviceOnline: boolean;
  aidHex?: string;
  profile: EsimProfileItem;
  showSensitive: boolean;
  renaming: boolean;
  renameValue: string;
  switching: boolean;
  deleting: boolean;
  policyOpen: boolean;
  onRenameValueChange: (v: string) => void;
  onSwitch: () => void;
  onStartRename: () => void;
  onSubmitRename: () => void;
  onCancelRename: () => void;
  onTogglePolicy: () => void;
  onDelete: () => void;
  onPolicyChanged: () => void;
}

export function EsimProfileRow(props: EsimProfileRowProps) {
  const { t } = useI18n();
  const { profile: p, renaming } = props;
  const active = p.state === 1;
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          {!renaming ? (
            <>
              <div className="flex min-w-0 items-center gap-2">
                <span className={cx("h-2 w-2 flex-shrink-0 rounded-full", active ? "bg-green-500" : "bg-gray-300 dark:bg-gray-600")} />
                <span className="min-w-0 truncate text-sm font-medium text-gray-900 dark:text-white">{p.name || p.iccid}</span>
                <Tag type={active ? "success" : "info"} className="flex-shrink-0">
                  {p.stateText ? t(p.stateText) : null}
                </Tag>
              </div>
              <div className="ml-4 mt-0.5 flex flex-col gap-0.5 text-xs text-gray-500 dark:text-gray-400 sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-2">
                {p.serviceProviderName ? <span className="truncate">{p.serviceProviderName}</span> : null}
                <span className={cx("break-all font-mono", !props.showSensitive && "select-none blur-sm")}>{p.iccid}</span>
              </div>
            </>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input
                inputSize="default"
                value={props.renameValue}
                onChange={(e) => props.onRenameValueChange(e.target.value)}
                placeholder={t("输入新名称")}
                autoFocus
                className="w-full min-w-0 sm:max-w-xs"
                onKeyDown={(e) => {
                  if (e.key === "Enter") props.onSubmitRename();
                  else if (e.key === "Escape") props.onCancelRename();
                }}
              />
              <div className="grid grid-cols-2 gap-2 sm:flex">
                <Button variant="primary" size="small" onClick={props.onSubmitRename} className="!border-0">
                  {t("保存")}
                </Button>
                <Button size="small" onClick={props.onCancelRename} className="!border-0">
                  {t("取消")}
                </Button>
              </div>
            </div>
          )}
        </div>
        {!renaming ? (
          // One primary action plus a menu, like an iOS list row, instead of
          // four colored buttons per profile.
          <div className="flex shrink-0 items-center gap-1 self-end sm:self-auto">
            <Button variant={active ? "default" : "success"} size="small" plain loading={props.switching} onClick={props.onSwitch}>
              {active ? t("禁用") : t("切换")}
            </Button>
            <button
              type="button"
              aria-label={t("更多操作")}
              title={t("更多操作")}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({ x: rect.right, y: rect.bottom });
              }}
              className={cx("inline-flex h-9 w-9 items-center justify-center rounded-full hover:bg-fill-4 [&_svg]:h-5 [&_svg]:w-5", props.policyOpen ? "text-accent" : "text-label-2")}
            >
              <MoreHorizontalRegular />
            </button>
            <ContextMenu
              open={Boolean(menu)}
              anchor={menu}
              onClose={() => setMenu(null)}
              title={p.name || p.iccid}
              items={[
                { label: t("改名"), icon: <RenameRegular />, onSelect: props.onStartRename },
                { label: props.policyOpen ? t("收起策略") : t("卡策略"), icon: <ShieldRegular />, onSelect: props.onTogglePolicy },
                { label: active ? t("删除（请先切换到另一张卡）") : t("删除"), icon: <DeleteRegular />, destructive: true, disabled: active || props.deleting, onSelect: props.onDelete },
              ]}
            />
          </div>
        ) : null}
      </div>
      {props.policyOpen ? (
        <div className="border-t-0 px-3 pb-3 sm:px-4">
          <EsimCardPolicyInline
            deviceId={props.deviceId}
            iccid={p.iccid}
            isActiveCard={active}
            deviceOnline={props.deviceOnline}
            onPolicyChanged={props.onPolicyChanged}
          />
        </div>
      ) : null}
    </>
  );
}
