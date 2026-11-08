import { useRef, useState } from "react";
import { CameraRegular, DeleteRegular, ImageRegular } from "@fluentui/react-icons";
import { apiMessage } from "../../api";
import { cx } from "../../lib/utils";
import { useI18n } from "../../lib/i18n";
import { useAuth } from "../../store/auth";
import { ListRow, ListSection, Sheet } from "../ios";
import { message } from "../ui/message";

/** The signed-in administrator: their photo, or the first letter of the name. */
export function UserAvatar({ className }: { className?: string }) {
  const { user, avatar } = useAuth();
  const initial = (user?.username || "A").slice(0, 1).toUpperCase();
  return (
    <span className={cx("ios-avatar overflow-hidden", className)}>
      {avatar ? <img key={avatar.length} src={avatar} alt="" className="ios-avatar-photo h-full w-full object-cover" draggable={false} /> : initial}
    </span>
  );
}

const SIZE = 256;

/** Crops the middle square of a photo and scales it to 256×256. */
async function squareImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canvas");
  context.imageSmoothingQuality = "high";
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, SIZE, SIZE);
  bitmap.close();
  const webp = canvas.toDataURL("image/webp", 0.86);
  // Browsers without a WebP encoder fall back to PNG; JPEG is smaller.
  return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/jpeg", 0.88);
}

/**
 * The profile card, as in the Apple Account sheet: the photo large, with
 * choosing a new one and removing it.
 */
export function ProfileSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { user, avatar, setAvatar } = useAuth();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  const save = async (image: string) => {
    setBusy(true);
    try {
      await setAvatar(image);
      message.success(image ? t("头像已更新") : t("已移除头像"));
    } catch (error) {
      message.error(apiMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      message.error(t("请选择一张图片"));
      return;
    }
    try {
      await save(await squareImage(file));
    } catch {
      message.error(t("无法读取这张图片"));
    }
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("个人资料")} width="md:max-w-[420px]">
      <div className="flex flex-col items-center pb-6 pt-2">
        <button
          type="button"
          className="ios-avatar-edit relative rounded-full"
          onClick={() => input.current?.click()}
          disabled={busy}
          aria-label={t("选择照片")}
        >
          <UserAvatar className={cx("h-[96px] w-[96px] text-[40px]", busy && "opacity-60")} />
          <span className="ios-avatar-badge absolute bottom-0 right-0 inline-flex h-8 w-8 items-center justify-center rounded-full bg-accent text-white">
            <CameraRegular className="h-[18px] w-[18px]" />
          </span>
        </button>
        <div className="mt-3 ios-title-2 text-label">{user?.username || "Admin"}</div>
        <div className="ios-subhead text-label-2">{user?.role || t("管理员")}</div>
      </div>
      <ListSection footer={t("照片会裁成正方形，只保存在这台 Halo 上。")}>
        <ListRow icon={<ImageRegular />} iconColor="blue" title={avatar ? t("更换照片") : t("选择照片")} onClick={busy ? undefined : () => input.current?.click()} />
        {avatar ? <ListRow icon={<DeleteRegular />} iconColor="red" title={t("移除照片")} destructive onClick={busy ? undefined : () => void save("")} /> : null}
      </ListSection>
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/heic"
        className="hidden"
        onChange={(event) => {
          void choose(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
    </Sheet>
  );
}
