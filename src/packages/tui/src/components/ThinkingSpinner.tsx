import { useState, useEffect } from "react";
import { useTimeline } from "@opentui/react";
import { useTheme } from "./App";

const BRAILLE = [
  "⠁","⠂","⠄","⡀","⡈","⡐","⡠","⣀",
  "⣁","⣂","⣄","⣌","⣔","⣤","⣥","⣦",
  "⣮","⣶","⣷","⣿","⡿","⠿","⢟","⠟",
  "⡛","⠛","⠫","⢋","⠋","⠍","⡉","⠉",
  "⠑","⠡","⢁",
];
const FRAME_MS = 60;

export function ThinkingSpinner() {
  const { colors } = useTheme();
  const [frame, setFrame] = useState(0);

  const timeline = useTimeline({
    duration: BRAILLE.length * FRAME_MS,
    loop: true,
  });

  useEffect(() => {
    BRAILLE.forEach((_, i) => {
      timeline.call(() => setFrame(i), i * FRAME_MS);
    });
  }, []);

  return (
    <box paddingLeft={5} paddingTop={1} paddingBottom={1}>
      <text fg={colors.accent.brand}>{BRAILLE[frame]} thinking</text>
    </box>
  );
}
