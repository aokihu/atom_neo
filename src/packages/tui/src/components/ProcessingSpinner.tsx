import { useState, useEffect } from "react";
import { useTimeline } from "@opentui/react";
import { useTheme } from "./App";

const STARS = ["✶", "✸", "✹", "✺", "✹", "✷"];
const FRAME_MS = 200;

interface ProcessingSpinnerProps {
  label?: string;
}

export function ProcessingSpinner({ label = "" }: ProcessingSpinnerProps) {
  const { colors } = useTheme();
  const [frame, setFrame] = useState(0);

  const timeline = useTimeline({
    duration: STARS.length * FRAME_MS,
    loop: true,
  });

  useEffect(() => {
    STARS.forEach((_, i) => {
      timeline.call(() => setFrame(i), i * FRAME_MS);
    });
  }, []);

  const text = label ? `${STARS[frame]} ${label}` : STARS[frame];

  return <text fg={colors.accent.brand}>{text}</text>;
}
