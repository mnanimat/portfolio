import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

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
    title: "MN Animation — Máquinas em movimento",
    description: "Explore a moto peça por peça, assista à coreografia Rain × Snow e crie no Motion Forge.",
  },
  twitter: {
    card: "summary_large_image",
    title: "MN Animation — Máquinas em movimento",
    description: "3D, motion e film em uma experiência interativa.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000").split(",")[0].trim();
  const protocol = (requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https")).split(",")[0].trim();
  const metadataBase = new URL(`${protocol}://${host}`);
  const imageUrl = new URL("/og.png", metadataBase).toString();

  return {
    ...baseMetadata,
    metadataBase,
    openGraph: {
      ...baseMetadata.openGraph,
      url: metadataBase,
      images: [{ url: imageUrl, width: 1731, height: 909, alt: "MN Animation — Máquinas em movimento" }],
    },
    twitter: {
      ...baseMetadata.twitter,
      images: [imageUrl],
    },
  };
}

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
