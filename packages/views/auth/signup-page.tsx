"use client";

import { useCallback, useState, type ReactElement, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@multica/ui/components/ui/card";
import { Input } from "@multica/ui/components/ui/input";
import { Button } from "@multica/ui/components/ui/button";
import { Label } from "@multica/ui/components/ui/label";
import { useAuthStore } from "@multica/core/auth";
import { workspaceKeys } from "@multica/core/workspace/queries";
import { api } from "@multica/core/api";
import { ApiError } from "@multica/core/api/client";
import { useT } from "../i18n";

// Email + password signup. On success the user is automatically logged
// in (same JWT + cookie path as the login form) and `onSuccess` fires
// for the host shell to compute a destination URL.

interface SignupPageProps {
  logo?: ReactNode;
  /** Called after successful account creation + auto-login. */
  onSuccess: () => void;
  /** Called after a token is obtained (web shell uses it to set the
   *  logged-in indicator cookie). */
  onTokenObtained?: () => void;
  /** Where the "Already have an account? Sign in" link should go. */
  loginHref: string;
  /** Renderer for the in-app link. See LoginPage's LinkComponent prop. */
  LinkComponent?: (props: { href: string; className?: string; children: ReactNode }) => ReactElement;
}

function DefaultLink({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <a href={href} className={className}>
      {children}
    </a>
  );
}

export function SignupPage({
  logo,
  onSuccess,
  onTokenObtained,
  loginHref,
  LinkComponent = DefaultLink,
}: SignupPageProps) {
  const { t } = useT("auth");
  const qc = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!email) {
        setError(t(($) => $.common.email_required));
        return;
      }
      if (!password) {
        setError(t(($) => $.common.password_required));
        return;
      }
      setLoading(true);
      setError("");
      try {
        await useAuthStore.getState().register(email, password, name.trim() || undefined);

        const wsList = await api.listWorkspaces();
        qc.setQueryData(workspaceKeys.list(), wsList);
        onTokenObtained?.();
        onSuccess();
      } catch (err) {
        // Map known server errors to localised UI messages. The server
        // returns 400 / 409 with English strings; we surface our own
        // translations rather than echo raw English back to the user.
        if (err instanceof ApiError) {
          if (err.status === 409) {
            setError(t(($) => $.errors.email_taken));
          } else if (err.status === 400) {
            const m = err.message || "";
            if (m.includes("at most")) {
              setError(t(($) => $.errors.password_too_long));
            } else if (m.includes("at least")) {
              setError(t(($) => $.errors.password_too_short));
            } else if (m.includes("invalid email")) {
              setError(t(($) => $.errors.invalid_email));
            } else {
              setError(t(($) => $.errors.register_failed));
            }
          } else {
            setError(t(($) => $.errors.register_failed));
          }
        } else {
          setError(
            err instanceof Error
              ? err.message
              : t(($) => $.errors.server_unreachable),
          );
        }
        setLoading(false);
      }
    },
    [email, password, name, onSuccess, onTokenObtained, qc, t],
  );

  return (
    <div className="flex min-h-svh items-center justify-center">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          {logo && <div className="mx-auto mb-4">{logo}</div>}
          <CardTitle className="text-2xl">{t(($) => $.signup.title)}</CardTitle>
          <CardDescription>{t(($) => $.signup.description)}</CardDescription>
        </CardHeader>
        <CardContent>
          <form id="signup-form" onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="signup-email">{t(($) => $.common.email)}</Label>
              <Input
                id="signup-email"
                type="email"
                placeholder={t(($) => $.common.email_placeholder)}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                autoFocus
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-name">
                {t(($) => $.signup.name_label)}{" "}
                <span className="text-xs text-muted-foreground">
                  {t(($) => $.signup.name_optional)}
                </span>
              </Label>
              <Input
                id="signup-name"
                type="text"
                placeholder={t(($) => $.signup.name_placeholder)}
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="signup-password">{t(($) => $.common.password)}</Label>
              <Input
                id="signup-password"
                type="password"
                placeholder={t(($) => $.common.password_placeholder)}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <p className="text-xs text-muted-foreground">
                {t(($) => $.signup.password_hint)}
              </p>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
          </form>
        </CardContent>
        <CardFooter className="flex flex-col gap-3">
          <Button
            type="submit"
            form="signup-form"
            className="w-full"
            size="lg"
            disabled={!email || !password || loading}
          >
            {loading
              ? t(($) => $.signup.submitting)
              : t(($) => $.signup.submit)}
          </Button>
          <p className="text-sm text-muted-foreground">
            {t(($) => $.signup.have_account)}{" "}
            <LinkComponent
              href={loginHref}
              className="font-medium text-foreground underline-offset-4 hover:underline"
            >
              {t(($) => $.signup.login_link)}
            </LinkComponent>
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
