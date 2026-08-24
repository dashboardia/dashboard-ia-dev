import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import Dashboard from "./dashboard-client";
import AutoRefresh from "../components/auto-refresh";
import { authOptions } from "../lib/auth";
import { getDashboardData } from "../lib/dashboard";
import { getConfigurationStatus } from "../lib/env";
import { getBillingOverview } from "../lib/billing";

export const dynamic = "force-dynamic";

function getDateLabel() {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    timeZone: "America/Sao_Paulo",
  }).format(new Date()).toUpperCase();
}

export default async function Home() {
  const configuration = getConfigurationStatus();
  const dateLabel = getDateLabel();

  if (!configuration.githubAuth || !configuration.database) {
    return <Dashboard setupMode dateLabel={dateLabel} />;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");
  await getBillingOverview(session.user);
  const data = await getDashboardData(session.user);
  const hasLiveWork = Boolean(data.activeWork?.length);

  return <><AutoRefresh active={hasLiveWork} interval={5000} showIndicator={false} /><Dashboard data={data} user={session.user} dateLabel={dateLabel} /></>;
}
