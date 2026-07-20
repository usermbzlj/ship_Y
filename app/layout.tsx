import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "远穹 · 星舰航程模拟",
  description: "以真实因果驱动的星际移民船与多智能体舰长实验。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
