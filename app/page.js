import { getServerSession } from "next-auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import Dashboard from "./dashboard-client";
import AutoRefresh from "../components/auto-refresh";
import { authOptions } from "../lib/auth";
import { getDashboardData } from "../lib/dashboard";
import { getConfigurationStatus } from "../lib/env";
import { getBillingOverview } from "../lib/billing";
import { decodeRememberedReturnPath, repositoryAuthorizationReturnPath, RETURN_PATH_COOKIE } from "../lib/return-navigation";

export const dynamic = "force-dynamic";

function getDateLabel() {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date()).toUpperCase();
}

export default async function Home({ searchParams }) {
  const configuration = getConfigurationStatus();
  const dateLabel = getDateLabel();
  const params = await searchParams;

  if (!configuration.githubAuth || !configuration.database) {
    return <Dashboard setupMode dateLabel={dateLabel} />;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  const cookieStore = await cookies();
  const rememberedPath = decodeRememberedReturnPath(cookieStore.get(RETURN_PATH_COOKIE)?.value);
  const authorizationReturnPath = repositoryAuthorizationReturnPath(params, rememberedPath, { allowRemembered: true });
  if (authorizationReturnPath && authorizationReturnPath !== "/") redirect(authorizationReturnPath);
  await getBillingOverview(session.user);
  const data = await getDashboardData(session.user);
  const hasLiveWork = Boolean(data.activeWork?.length);

  return <><AutoRefresh active={hasLiveWork} interval={5000} showIndicator={false} /><Dashboard data={data} user={session.user} dateLabel={dateLabel} /></>;
}
