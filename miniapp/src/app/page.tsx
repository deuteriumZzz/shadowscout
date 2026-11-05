import { Oswald } from "next/font/google";
import { PrototypeEntry } from "@/components/prototype/prototype-entry";
import "./prototype/prototype.css";

// Condensed numerals and headings, like broadcast graphics. Body text stays Inter.
const display = Oswald({ subsets: ["latin", "cyrillic"], variable: "--font-display" });

export default function Home() {
  return (
    <div className={display.variable}>
      <PrototypeEntry />
    </div>
  );
}
