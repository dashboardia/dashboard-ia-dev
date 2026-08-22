import { getServerSession } from "next-auth";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { authOptions } from "../../lib/auth";
import { env, getConfigurationStatus } from "../../lib/env";
import { RETURN_PATH_COOKIE, safeInternalReturnPath } from "../../lib/return-navigation";
import LoginCard from "./login-card";

export const metadata = {
  title: "Entrar | Forgeboard",
};

export const dynamic = "force-dynamic";

function canonicalOrigin() {
  const productionFallback = "https://dashboardia.app";
  try {
    const configured = new URL(env.NEXTAUTH_URL || productionFallback);
    if (process.env.NODE_ENV === "production" && configured.hostname.endsWith(".railway.app")) return productionFallback;
    return configured.origin;
  } catch {
    return process.env.NODE_ENV === "production" ? productionFallback : null;
  }
}

function copySearchParams(target, params) {
  for (const [key, value] of Object.entries(params ?? {})) {
    if (Array.isArray(value)) value.forEach((item) => target.searchParams.append(key, item));
    else if (typeof value === "string" && value) target.searchParams.set(key, value);
  }
}

function decodeRememberedPath(value) {
  if (!value) return null;
  try { return decodeURIComponent(value); } catch { return value; }
}

export default async function LoginPage({ searchParams }) {
  const configuration = getConfigurationStatus();
  const params = await searchParams;
  const configured = configuration.database && configuration.githubAuth;

  if (configured && process.env.NODE_ENV === "production") {
    const canonical = canonicalOrigin();
    const requestHeaders = await headers();
    const currentHost = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "").split(",")[0].trim();
    if (canonical && currentHost && currentHost !== new URL(canonical).host) {
      const target = new URL("/login", canonical);
      copySearchParams(target, params);
      redirect(target.toString());
    }
  }

  const cookieStore = await cookies();
  const rememberedPath = decodeRememberedPath(cookieStore.get(RETURN_PATH_COOKIE)?.value);
  const callbackUrl = safeInternalReturnPath(params?.callbackUrl ?? params?.state ?? rememberedPath ?? "/");

  if (configured) {
    const session = await getServerSession(authOptions);
    if (session?.user) redirect(callbackUrl);
  }

  return (
    <main className="login-page">
      <LoginCard
        configured={configured}
        error={params?.error ?? null}
        callbackUrl={callbackUrl}
      />
    </main>
  );
}
