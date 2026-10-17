import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "./sw-register";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RODAKU - Transportasi On-Demand",
  description:
    "Platform mobilitas on-demand RODAKU. Pesan armada dan pantau driver secara real-time langsung dari browser.",
  applicationName: "RODAKU",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "RODAKU",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#0F172A",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="id"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-[#F8FAFC] font-sans text-[#0F172A]">
        {children}

        <RegisterSW />
      </body>
    </html>
  );
}
