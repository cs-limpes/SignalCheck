import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SignalCheck",
  description: "Privacy-first screenshot OCR and evidence reports for human review."
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#18201f"
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
