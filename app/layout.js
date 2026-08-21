import "./globals.css";
import "./preferences.css";
import "./settings/settings.css";

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
