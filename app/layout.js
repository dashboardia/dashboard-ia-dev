import "./globals.css";

export const metadata = {
  title: "Forgeboard",
  description: "Demandas, código e observabilidade em um só lugar.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
