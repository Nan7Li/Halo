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

  return (
    <div className="relative flex h-full w-full items-center justify-center">
      <div className="relative w-full max-w-[400px] px-5">
        <div className="vocat-enter vocat-enter-1 mb-8 text-center">
          <div className="mx-auto mb-5 flex h-[72px] w-[72px] items-center justify-center rounded-[20px] bg-bg-2 shadow-[0_4px_20px_rgba(0,0,0,0.08)] ring-1 ring-separator dark:bg-white/10 dark:ring-white/10">
            <BrandLogo className="h-12 w-12 text-accent" />
          </div>
          <h1 className="font-display text-[28px] font-semibold leading-none tracking-[-0.04em] text-label dark:text-label">
            Halo
          </h1>
          <p className="mt-2 text-[14px] tracking-tight text-label-2 dark:text-white/45">{t("高通模块专业测试工具")}</p>
        </div>

        {ssoNotice ? (
          <div role={ssoNotice.error ? "alert" : "status"} className={`mb-4 rounded-2xl border px-4 py-3 text-[14px] leading-relaxed ${ssoNotice.error ? "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-200" : "border-separator bg-bg-2 text-label-2 dark:border-white/10 dark:bg-white/5 dark:text-white/70"}`}>
            {t(ssoNotice.text)}
          </div>
        ) : null}

        <form onSubmit={submit} className="space-y-3">
          <label className="vocat-enter vocat-enter-2 halo-login-field flex items-center gap-3 px-4">
            <PersonRegular className="h-5 w-5 shrink-0 text-label-3 dark:text-white/35" />
            <input
              className="h-12 w-full bg-transparent text-[16px] tracking-tight text-label outline-none placeholder:text-label-3 dark:text-white dark:placeholder:text-white/30"
              placeholder={t("用户名")}
              type="text"
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </label>
          <label className="vocat-enter vocat-enter-2 halo-login-field flex items-center gap-3 px-4">
            <LockClosedRegular className="h-5 w-5 shrink-0 text-label-3 dark:text-white/35" />
            <input
              className="h-12 w-full bg-transparent text-[16px] tracking-tight text-label outline-none placeholder:text-label-3 dark:text-white dark:placeholder:text-white/30"
              placeholder={t("密码")}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>

          <button
            type="submit"
            disabled={working}
            className="vocat-enter vocat-enter-3 flex h-[50px] w-full items-center justify-center rounded-full bg-accent text-[17px] font-semibold text-[var(--color-on-primary)] shadow-[0_8px_22px_rgb(var(--color-primary-rgb)/0.32)] transition-transform duration-[180ms] ease-[cubic-bezier(0.32,0.72,0,1)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-70"
          >
            {t("登录")}
          </button>
        </form>

        {providers?.sso.enabled ? (
          <a
            href={`/api/auth/sso/start?${new URLSearchParams({ redirect }).toString()}`}
            className="vocat-enter vocat-enter-3 mt-3 flex h-[50px] w-full items-center justify-center rounded-full border border-separator bg-bg-2 text-[16px] font-semibold text-label-2 transition-transform duration-[180ms] active:scale-[0.97] dark:border-white/10 dark:bg-white/5 dark:text-white/80"
          >
            {t("通过 {provider} 登录").replace("{provider}", providers.sso.displayName || "SSO")}
          </a>
        ) : null}

        <p className="vocat-enter vocat-enter-4 mt-8 text-center text-[12px] leading-relaxed tracking-tight text-black/30 dark:text-white/30">
          Halo
          <br />
          {t("基于 VoCat，原作者 Vocat Project Authors")}
        </p>
      </div>
    </div>
  );
}
