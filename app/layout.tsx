import type { Metadata } from "next";
import { AppShell } from "./components/AppShell";
import "./tokens.css";

export const metadata: Metadata = {
  title: "AI CRM+ERP Platform",
  description: "AI-powered multi-tenant CRM and ERP platform",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
