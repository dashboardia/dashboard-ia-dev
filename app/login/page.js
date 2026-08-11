import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { authOptions } from "../../lib/auth";
import { getConfigurationStatus } from "../../lib/env";
import LoginCard from "./login-card";

export const metadata = {
  title: "Entrar | Forgeboard",
};

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }) {
  const configuration = getConfigurationStatus();
  const params = await searchParams;
  const configured = configuration.database && configuration.githubAuth;

  if (configured) {
    const session = await getServerSession(authOptions);
    if (session?.user) redirect("/");
  }

  return (
    <main className="login-page">
      <LoginCard
        configured={configured}
        error={params?.error ?? null}
      />
    </main>
  );
}
