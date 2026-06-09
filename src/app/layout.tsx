import type { Metadata } from "next";
import "@fontsource/satisfy";
import "./globals.css";

export const metadata: Metadata = {
  title: "Plandit",
  description: "A modern calendar workspace for shared planning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
