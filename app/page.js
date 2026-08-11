import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import Dashboard from "./dashboard-client";
import { authOptions } from "../lib/auth";
import { getConfigurationStatus } from "../lib/env";

export const dynamic = "force-dynamic";

export default async function Home() {
  const configuration = getConfigurationStatus();

  if (!configuration.githubAuth || !configuration.database) {
    return <Dashboard setupMode />;
  }

  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/login");

  return <Dashboard user={session.user} />;
}
