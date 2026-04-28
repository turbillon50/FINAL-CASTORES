import { motion } from "framer-motion";
import { useEffect, useState } from "react";

interface ProgressRingProps {
  progress: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

export function ProgressRing({ progress, size = 60, strokeWidth = 4, className = "" }: ProgressRingProps) {
  const [currentProgress, setCurrentProgress] = useState(0);
  
  useEffect(() => {
    // Small delay to allow the animation to trigger after mount
    const timer = setTimeout(() => {
      setCurrentProgress(progress);
    }, 100);
    return () => clearTimeout(timer);
  }, [progress]);

  const center = size / 2;
  const radius = center - strokeWidth;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (currentProgress / 100) * circumference;

  return (
    <div className={`relative flex items-center justify-center ${className}`} style={{ width: size, height: size }}>
      <svg className="transform -rotate-90 w-full h-full">
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="transparent"
          stroke="rgba(255, 255, 255, 0.1)"
          strokeWidth={strokeWidth}
        />
        {/* Progress circle */}
        <motion.circle
          cx={center}
          cy={center}
          r={radius}
          fill="transparent"
          stroke="hsl(var(--primary))"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={circumference}
          strokeLinecap="round"
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 1.5, ease: "easeOut" }}
        />
      </svg>
      <div className="absolute font-display text-sm tracking-wide text-foreground">
        {Math.round(currentProgress)}%
      </div>
    </div>
  );
}
