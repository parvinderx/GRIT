import type { Metadata, Viewport } from "next";
import { Inter, Space_Grotesk, JetBrains_Mono, Schibsted_Grotesk, Atkinson_Hyperlegible_Next, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/sonner";
import { StoryPanel } from "@/components/demo/StoryPanel";
import { env } from "@/lib/env";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
// GRIT portal type: Space Grotesk (student screens, matching the GRIT student portal).
const spaceGrotesk = Space_Grotesk({ variable: "--font-space-grotesk", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const jetbrainsMono = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });
// Student view: Schibsted Grotesk for headlines, Atkinson Hyperlegible Next for reading text,
// dates and codes.
const schibsted = Schibsted_Grotesk({ variable: "--font-schibsted", subsets: ["latin"] });
// GRIT brand type (student + interviewer screens): Plus Jakarta Sans, a rounded geometric sans.
const jakarta = Plus_Jakarta_Sans({ variable: "--font-jakarta", subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], style: ["normal", "italic"] });
const atkinson = Atkinson_Hyperlegible_Next({ variable: "--font-atkinson", subsets: ["latin"], adjustFontFallback: false });

export const metadata: Metadata = {
  title: "GRIT · Interview Scheduling",
  description: "Level Clearance Interview scheduling for GRIT Track Badges.",
};

// viewportFit "cover" lets env(safe-area-inset-*) report real insets on notched phones
// (used by the student booking bar and the prototype controls).
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${schibsted.variable} ${atkinson.variable} ${jakarta.variable} h-full`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
        >
          Skip to content
        </a>
        {env.demoPasscode && (
          <div role="note" className="bg-amber-100 px-4 py-1 text-center text-xs font-medium text-amber-950">
            Demo deploy: sample data only, not a secure system.
          </div>
        )}
        {children}
        {env.devTools && <StoryPanel />}
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
