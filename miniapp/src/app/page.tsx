import { Oswald } from "next/font/google";
import { AppEntry } from "@/features/app-shell/app-entry";
import "./theme.css";

// Condensed numerals and headings, like broadcast graphics. Body text stays Inter.
const display = Oswald({ subsets: ["latin", "cyrillic"], variable: "--font-display" });

export default function Home() {
  return (
    <div className={display.variable}>
      <AppEntry />
    </div>
  );
}
