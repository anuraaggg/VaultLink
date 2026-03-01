import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import DotGrid from "@/components/DotGrid";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "VaultLink",
  description: "Encrypted file sharing with client-side Web Crypto",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${spaceGrotesk.className} relative min-h-screen overflow-x-hidden`}>
        <div className="pointer-events-none fixed inset-0 -z-10 opacity-35">
          <DotGrid
            dotSize={6}
            gap={20}
            baseColor="#5f5f5f"
            activeColor="#ffffff"
            proximity={150}
            speedTrigger={100}
            shockRadius={250}
            shockStrength={5}
            maxSpeed={5000}
            resistance={750}
            returnDuration={1.5}
          />
        </div>
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
