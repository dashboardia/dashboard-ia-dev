import "./globals.css";
import "./preferences.css";
import "./settings-theme-fix.css";
import "./environment-recovery.css";
import "./sidebar-collapsible.css";

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
