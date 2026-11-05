"use client";

import { motion } from "framer-motion";
import { M } from "@/ui/motion";

/** One treatment for every state the feed can be in, instead of a screen of its own for each. */
export function FeedNotice({ icon, title, text, action, onAction }: { icon: React.ReactNode; title: string; text: string; action: string; onAction: () => void }) {
  return (
    <motion.section className="pn-notice" role="status" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={M.spring.gentle}>
      <motion.span className="pn-notice__icon" initial={{ scale: 0.4, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={M.spring.bouncy}>{icon}</motion.span>
      <h2 className="pn-h2">{title}</h2>
      <p className="pn-small pn-muted">{text}</p>
      <motion.button className="pn-btn pn-btn--primary" style={{ alignSelf: "stretch" }} whileTap={{ scale: M.press }} onClick={onAction}>{action}</motion.button>
    </motion.section>
  );
}
