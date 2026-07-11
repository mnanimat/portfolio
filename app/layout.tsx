import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const SITE_URL = "https://mn-animation-3d-portfolio.mnanimat.chatgpt.site";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const baseMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "MN Animation — 3D, Motion & Film",
  description: "Portfólio interativo de modelagem e animação 3D, experiência explodida de moto, Fight Lab, Motion Forge e edição de vídeo sob medida.",
  applicationName: "MN Animation",
  authors: [{ name: "MN Animation", url: "mailto:mnanimat@gmail.com" }],
  keywords: ["animação 3D", "modelagem 3D", "Unreal Engine", "edição de vídeo", "motion design", "portfólio 3D"],
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icon-512.png", sizes: "512x512", type: "image/png" }],
    shortcut: "/icon-192.png",
    apple: "/icon-192.png",
  },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: SITE_URL,
    title: "MN Animation — Máquinas em movimento",
    description: "Explore a moto peça por peça, assista à coreografia Rain × Snow e crie no Motion Forge.",
    images: [{ url: "/og.png", width: 1731, height: 909, alt: "MN Animation — Máquinas em movimento" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MN Animation — Máquinas em movimento",
    description: "3D, motion e film em uma experiência interativa.",
    images: ["/og.png"],
  },
};

export const metadata = baseMetadata;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: "#05070d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
