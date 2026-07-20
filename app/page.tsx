import type { Metadata } from "next";
import { MissionControl } from "./mission-control";

export const metadata: Metadata = {
  title: "远穹 · 星舰航程模拟",
  description:
    "由舰载人工智能负责的高可信星际移民船系统模拟。",
};

export default function Home() {
  return <MissionControl />;
}
