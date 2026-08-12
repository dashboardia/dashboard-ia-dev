import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import Dashboard from "./dashboard-client";
import { authOptions } from "../lib/auth";
import { getDashboardData } from "../lib/dashboard";
import { getConfigurationStatus } from "../lib/env";

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
  const data = await getDashboardData(session.user);

  return <Dashboard data={data} user={session.user} dateLabel={dateLabel} />;
}
