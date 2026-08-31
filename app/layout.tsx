import type { Metadata } from "next";

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
      <body>{children}</body>
    </html>
  );
}
