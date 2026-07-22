import type { Metadata } from "next";
import { IBM_Plex_Mono, Noto_Sans_SC, Oxanium } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const oxanium = Oxanium({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-oxanium",
  display: "swap",
});

const notoSansSc = Noto_Sans_SC({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-noto-sans-sc",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ibm-plex-mono",
  display: "swap",
});

function requestOrigin(host: string | null, forwardedProtocol: string | null) {
  const safeHost = host?.split(",")[0]?.trim() || "localhost:3000";
  const protocol =
    forwardedProtocol?.split(",")[0]?.trim() ||
    (safeHost.startsWith("localhost") || safeHost.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${protocol}://${safeHost}`;
}

export async function generateMetadata(): Promise<Metadata> {
  const incomingHeaders = await headers();
  const origin = requestOrigin(
    incomingHeaders.get("x-forwarded-host") ?? incomingHeaders.get("host"),
    incomingHeaders.get("x-forwarded-proto"),
  );

  return {
    metadataBase: new URL(origin),
    title: "远穹 · 星舰航程模拟",
    description:
      "把全舰交给 AI 舰长之后：观察 2,120 名持续个体与九个权威物理域如何完成一次真实因果驱动的星际远航。",
    openGraph: {
      type: "website",
      locale: "zh_CN",
      url: origin,
      title: "远穹 · 把全舰交给 AI 舰长之后",
      description:
        "签发一次不可忽略的最高指令，然后观察固定 AI 舰长体系在真实设备、资源与物理约束下完成远航。",
      images: [
        {
          url: "/og.png",
          width: 1729,
          height: 910,
          alt: "远穹号深空舰桥与双环民用星际移民舰",
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title: "远穹 · 把全舰交给 AI 舰长之后",
      description: "2,120 名持续个体，九个权威物理域，一次不可忽略的最高指令。",
      images: ["/og.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${oxanium.variable} ${notoSansSc.variable} ${ibmPlexMono.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
