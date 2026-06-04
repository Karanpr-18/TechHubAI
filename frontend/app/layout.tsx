import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Agent Swarm - The Tech Stack Council",
  description:
    "An open-source multi-agent system where 4 AI agents with completely different perspectives debate and argue to find the perfect tech stack and architecture for your project.",
  keywords: [
    "AI",
    "agent swarm",
    "tech stack",
    "architecture",
    "multi-agent",
    "debate",
    "open source",
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
