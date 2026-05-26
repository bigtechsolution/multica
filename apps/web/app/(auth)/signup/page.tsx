"use client";

import { Suspense, useEffect, type ReactNode } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { sanitizeNextUrl, useAuthStore } from "@multica/core/auth";
import { workspaceKeys } from "@multica/core/workspace/queries";
import {
  paths,
  resolvePostAuthDestination,
  useHasOnboarded,
} from "@multica/core/paths";
import { api } from "@multica/core/api";
import type { Workspace } from "@multica/core/types";
import Link from "next/link";
import { SignupPage } from "@multica/views/auth";
import { setLoggedInCookie } from "@/features/auth/auth-cookie";

// Same destination-picking logic as the login page — kept inline rather
// than exported so the two flows can diverge later without coupling.
async function resolveLoggedInDestination(
  qc: QueryClient,
  hasOnboarded: boolean,
  workspaces: Workspace[],
): Promise<string> {
  if (!hasOnboarded) {
    try {
      const invites = await api.listMyInvitations();
      if (invites.length > 0) {
        qc.setQueryData(workspaceKeys.myInvitations(), invites);
        return paths.invitations();
      }
    } catch {
      // fall through
    }
  }
  return resolvePostAuthDestination(workspaces, hasOnboarded);
}

function NextLinkAdapter({ href, className, children }: { href: string; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={className}>
      {children}
    </Link>
  );
}

function SignupPageContent() {
  const router = useRouter();
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const isLoading = useAuthStore((s) => s.isLoading);
  const searchParams = useSearchParams();
  const nextUrl = sanitizeNextUrl(searchParams.get("next"));
  const hasOnboarded = useHasOnboarded();

  // Already authenticated — bounce to the post-login destination. Skipping
  // this would leave the user staring at a signup form for an account
  // they already have.
  useEffect(() => {
    if (isLoading || !user) return;
    if (nextUrl) {
      router.replace(nextUrl);
      return;
    }
    const list = qc.getQueryData<Workspace[]>(workspaceKeys.list()) ?? [];
    void resolveLoggedInDestination(qc, hasOnboarded, list).then((dest) =>
      router.replace(dest),
    );
  }, [isLoading, user, router, nextUrl, hasOnboarded, qc]);

  const handleSuccess = async () => {
    const currentUser = useAuthStore.getState().user;
    const onboarded = currentUser?.onboarded_at != null;
    if (nextUrl) {
      router.push(nextUrl);
      return;
    }
    const list = qc.getQueryData<Workspace[]>(workspaceKeys.list()) ?? [];
    const dest = await resolveLoggedInDestination(qc, onboarded, list);
    router.push(dest);
  };

  return (
    <SignupPage
      onSuccess={handleSuccess}
      onTokenObtained={setLoggedInCookie}
      loginHref={nextUrl ? `/login?next=${encodeURIComponent(nextUrl)}` : "/login"}
      LinkComponent={NextLinkAdapter}
    />
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SignupPageContent />
    </Suspense>
  );
}
