import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "UMD Dining Tool",
  description: "Standalone UMD dining digest service.",
  icons: {
    icon: "/favicon.ico?v=3",
    shortcut: "/favicon.ico?v=3",
    apple: "/favicon.ico?v=3"
  }
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
