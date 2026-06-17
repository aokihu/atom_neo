import { useState, useEffect, useRef } from "react";
import { useTheme } from "./App";

type RGB = [number, number, number];

const FRAMES: number[][] = [
  [0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
  [1.00, 0.00, 0.00, 0.00, 0.00, 0.00],
  [0.20, 1.00, 0.00, 0.00, 0.00, 0.00],
  [0.20, 0.60, 1.00, 0.00, 0.00, 0.00],
  [0.20, 0.46, 0.73, 1.00, 0.00, 0.00],
  [0.00, 0.20, 0.46, 0.73, 1.00, 0.00],
  [0.00, 0.00, 0.20, 0.46, 0.73, 1.00],
  [0.00, 0.00, 0.00, 0.20, 0.46, 1.00],
  [0.00, 0.00, 0.00, 0.00, 0.20, 1.00],
  [0.00, 0.00, 0.00, 0.00, 0.00, 1.00],
  [0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
  [0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
  [0.00, 0.00, 0.00, 0.00, 1.00, 0.20],
  [0.00, 0.00, 0.00, 1.00, 0.60, 0.20],
  [0.00, 0.00, 1.00, 0.60, 0.20, 0.00],
  [0.00, 1.00, 0.73, 0.46, 0.20, 0.00],
  [1.00, 0.73, 0.46, 0.20, 0.00, 0.00],
  [1.00, 0.60, 0.20, 0.00, 0.00, 0.00],
  [1.00, 0.20, 0.00, 0.00, 0.00, 0.00],
  [1.00, 0.00, 0.00, 0.00, 0.00, 0.00],
  [0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
  [0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
  [0.12, 0.12, 0.12, 0.12, 0.12, 0.12],
  [0.04, 0.04, 0.04, 0.04, 0.04, 0.04],
  [0.01, 0.01, 0.01, 0.01, 0.01, 0.01],
  [0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
  [0.00, 0.00, 0.00, 0.00, 0.00, 0.00],
];

const INTERVAL_MS = 16;
const PROGRESS_PER_TICK = INTERVAL_MS / 80;

function parseHex(hex: string): RGB {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (m) return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
  return [255, 255, 255];
}

function toHex(rgb: RGB): string {
  return "#" + rgb.map(c => c.toString(16).padStart(2, "0")).join("");
}

function lerpRGB(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

export function BounceBarSpinner() {
  const { colors } = useTheme();
  const [tick, setTick] = useState(0);
  const frameRef = useRef(0);
  const progressRef = useRef(0);

  const hi = parseHex(colors.accent.brand);
  const lo = parseHex(colors.decoration.subtle);

  useEffect(() => {
    const id = setInterval(() => {
      progressRef.current += PROGRESS_PER_TICK;
      if (progressRef.current >= 1) {
        progressRef.current -= 1;
        frameRef.current = (frameRef.current + 1) % FRAMES.length;
      }
      setTick(t => t + 1);
    }, INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  const current = FRAMES[frameRef.current];
  const next = FRAMES[(frameRef.current + 1) % FRAMES.length];
  const t = progressRef.current;

  return (
    <box flexDirection="row">
      {current.map((v, i) => {
        const vi = v + (next[i] - v) * t;
        const ch = vi >= 0.2 ? "■" : "·";
        return <text key={i} fg={toHex(lerpRGB(lo, hi, vi))}>{ch}</text>;
      })}
    </box>
  );
}
