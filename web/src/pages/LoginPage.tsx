import { useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LockClosedRegular, PersonRegular } from "@fluentui/react-icons";
import { useAuth } from "../store/auth";
import { useI18n } from "../lib/i18n";
import { message } from "../components/ui/message";
import { BrandLogo } from "../components/shell/BrandLogo";
import { getSSOProviders } from "../api";
import type { SSOProviders } from "../types";
import { safeRedirect } from "../lib/safeRedirect";
import { ssoErrorMessage, SSO_RESULT_MESSAGES } from "../lib/sso";

/** Offer local and enabled SSO sign-in while preserving safe return paths and callback notices. */
export default function LoginPage() {
  const { login } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [working, setWorking] = useState(false);
  const [providers, setProviders] = useState<SSOProviders | null>(null);
  const [ssoNotice, setSSONotice] = useState<{ error: boolean; text: string } | null>(null);
  const redirect = safeRedirect(searchParams.get("redirect"), window.location.origin);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    /** Retry transient metadata failures at most three times without delaying local sign-in. */
    const load = (attempt: number) => {
      void getSSOProviders().then((data) => {
        if (!cancelled) setProviders(data);
      }).catch(() => {
        if (!cancelled && attempt < 3) {
          timer = window.setTimeout(() => load(attempt + 1), 1000 * 2 ** attempt);
        }
      });
    };
    load(0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    const error = searchParams.get("sso_error");
    const result = searchParams.get("sso_result");
    if (!error && !result) return;
    if (error) setSSONotice({ error: true, text: ssoErrorMessage(error) });
    else if (result && Object.hasOwn(SSO_RESULT_MESSAGES, result)) setSSONotice({ error: false, text: SSO_RESULT_MESSAGES[result] });
    const next = new URLSearchParams(searchParams);
    next.delete("sso_error");
    next.delete("sso_result");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  /** Validate local credentials and navigate to the safe return path after a successful password login. */
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!username || !password) {
      message.warning(t("请输入用户名和密码"));
      return;
    }
    setWorking(true);
    await new Promise((resolve) => setTimeout(resolve, 600));
    const ok = await login(username, password);
    setWorking(false);
    if (ok) {
      message.success(t("欢迎回来"));
      navigate(redirect, { replace: true });
    } else {
      message.error(t("登录失败，请检查凭证"));
    }
  }

  const sso = providers?.sso;
  return (
    // Sign in on a Liquid Glass card over the ambient wallpaper, with the
    // credentials as one inset grouped field group (like Settings > Apple
    // Account sign-in).
    <div className="ios-app ios-login relative flex h-full w-full items-center justify-center overflow-y-auto px-4 py-10">
      <div className="ios-login-card glass-thick relative w-full max-w-[400px] rounded-[var(--radius-xl)] px-6 pb-7 pt-9">
        <div className="vocat-enter vocat-enter-1 mb-7 text-center">
          <div className="mx-auto mb-4 flex h-[76px] w-[76px] items-center justify-center rounded-[22px] bg-[rgb(var(--ios-grouped-2))] shadow-[0_6px_22px_rgb(0_0_0/0.1)]">
            <BrandLogo className="h-12 w-12 text-accent" />
          </div>
          <h1 className="text-[28px] font-bold leading-[34px] tracking-[0.01em] text-label">Halo</h1>
          <p className="mt-1 ios-subhead text-label-2">{t("高通模块专业测试工具")}</p>
        </div>

        {ssoNotice ? (
          <div role={ssoNotice.error ? "alert" : "status"} className={`mb-4 rounded-[18px] px-4 py-3 ios-subhead ${ssoNotice.error ? "bg-sys-orange/15 text-sys-orange" : "bg-fill-3 text-label-2"}`}>
            {t(ssoNotice.text)}
          </div>
        ) : null}

        <form onSubmit={submit}>
          <div className="vocat-enter vocat-enter-2 ios-list mb-4">
            <label className="ios-row">
              <PersonRegular className="h-5 w-5 shrink-0 text-label-3" />
              <span className="ios-row-body">
                <input
                  className="w-full bg-transparent ios-body text-label outline-none placeholder:text-label-3"
                  placeholder={t("用户名")}
                  type="text"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                />
              </span>
            </label>
            <label className="ios-row">
              <LockClosedRegular className="h-5 w-5 shrink-0 text-label-3" />
              <span className="ios-row-body">
                <input
                  className="w-full bg-transparent ios-body text-label outline-none placeholder:text-label-3"
                  placeholder={t("密码")}
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </span>
            </label>
          </div>

          <button
            type="submit"
            disabled={working}
            className="vocat-enter vocat-enter-3 ios-press flex h-[50px] w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-[var(--color-on-primary)] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {working ? t("正在登录…") : t("登录")}
          </button>
        </form>

        {sso?.enabled ? (
          <a
            href={`/api/auth/sso/start?${new URLSearchParams({ redirect }).toString()}`}
            className="vocat-enter vocat-enter-3 glass glass-interactive mt-3 flex h-[50px] w-full items-center justify-center rounded-full text-[17px] font-semibold text-label"
          >
            {t("通过 {provider} 登录").replace("{provider}", sso.displayName || "SSO")}
          </a>
        ) : null}

        <p className="vocat-enter vocat-enter-4 mt-7 text-center ios-caption text-label-3">
          {t("基于 VoCat，原作者 Vocat Project Authors")}
        </p>
      </div>
    </div>
  );
}
