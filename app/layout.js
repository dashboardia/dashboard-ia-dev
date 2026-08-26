import "./globals.css";
import "./preferences.css";
import "./gray-theme.css";
import "./settings-theme-fix.css";
import "./settings/settings.css";
import "./settings/settings-ux.css";
import "./demands/demand-history.css";
import "./environment-recovery.css";
import "./sidebar-collapsible.css";
import "./execution-workbench.css";
import "./execution-automation.css";
import "./execution-status.css";
import "./execution-cycle-focus.css";
import "./action-center-toast.css";
import "./readability.css";
import "./experience-polish.css";
import "./dashboardia-neon.css";
import "./execution-command-center.css";

export const metadata = {
  title: "Dashboard IA",
  applicationName: "Dashboard IA",
  description: "Demandas, código e observabilidade em um só lugar.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
