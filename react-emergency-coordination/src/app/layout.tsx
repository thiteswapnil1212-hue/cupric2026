import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Geist, Geist_Mono } from "next/font/google";

const geistSans = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

export const metadata: Metadata = {
  title: "REACT | Emergency Coordination",
  description: "Human-supervised emergency response coordination.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn("font-sans", geistSans.variable, geistMono.variable)}
    >
      <body>{children}</body>
    </html>
  );
}
