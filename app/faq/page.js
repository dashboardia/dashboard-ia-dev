import AppShell from "../../components/app-shell";
import FaqClient from "../../components/faq-client";
import SectionHeader from "../../components/section-header";
import { requirePageUser } from "../../lib/page-access";
import { supportArticles } from "../../lib/support-knowledge";

export const dynamic = "force-dynamic";

export default async function FaqPage() {
  const user = await requirePageUser();
  return <AppShell user={user}><div className="section-page narrow-page"><SectionHeader eyebrow="SUPORTE" title="Ajuda e perguntas frequentes" description="Respostas práticas para configurar e usar o Dashboardia." /><section className="form-card faq-card"><FaqClient articles={supportArticles} /></section></div></AppShell>;
}
