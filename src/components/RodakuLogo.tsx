"use client";

import React, { useId } from "react";

type LogoProps = {
  className?: string;
  size?: "sm" | "md" | "lg";
  variant?: "dark" | "light"; // dark = teks gelap untuk latar putih; light = teks putih untuk latar navy
  showText?: boolean;
};

export default function RodakuLogo({
  className = "",
  size = "md",
  variant = "dark",
  showText = true,
}: LogoProps) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const gradId = `rodakuGrad-${uid}`;
  const glowId = `accentGlow-${uid}`;

  const iconSizes = {
    sm: "w-8 h-8",
    md: "w-10 h-10",
    lg: "w-12 h-12",
  };

  const textSizes = {
    sm: "text-lg",
    md: "text-2xl",
    lg: "text-3xl",
  };

  return (
    <div className={`inline-flex items-center gap-2.5 select-none ${className}`}>
      {/* Icon Emblem: The Kinetic Wheel R */}
      <div className={`relative flex items-center justify-center shrink-0 ${iconSizes[size]}`}>
        <svg
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full h-full drop-shadow-md"
          role="img"
          aria-label="Logo RODAKU"
        >
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3B82F6" />
              <stop offset="50%" stopColor="#1D4ED8" />
              <stop offset="100%" stopColor="#1E3A8A" />
            </linearGradient>
            <linearGradient id={glowId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#60A5FA" />
              <stop offset="100%" stopColor="#93C5FD" />
            </linearGradient>
          </defs>

          {/* Outer Wheel Rim / Tire Tread Contour */}
          <circle
            cx="50"
            cy="50"
            r="44"
            stroke={`url(#${gradId})`}
            strokeWidth="11"
            strokeDasharray="210 60"
            strokeLinecap="round"
          />

          {/* Inner Speed Track Loop */}
          <path
            d="M50 18 A32 32 0 1 1 24 68"
            stroke={`url(#${gradId})`}
            strokeWidth="7"
            strokeLinecap="round"
            opacity="0.4"
          />

          {/* Aerodynamic Kinetic Letter 'R' Core */}
          <path
            d="M36 28 H56 C66 28 73 34 73 42 C73 49 67 55 58 55 H46 V72"
            stroke={`url(#${gradId})`}
            strokeWidth="10"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Dynamic R Kick Leg */}
          <path
            d="M52 53 L69 72"
            stroke={`url(#${gradId})`}
            strokeWidth="10"
            strokeLinecap="round"
          />

          {/* Center Hub Glowing Indicator */}
          <circle cx="50" cy="42" r="5" fill={`url(#${glowId})`} />
        </svg>
      </div>

      {/* Brand Wordmark Typography */}
      {showText && (
        <div className={`font-black tracking-tight leading-none ${textSizes[size]}`}>
          <span className={variant === "light" ? "text-white" : "text-[#0F172A]"}>RODA</span>
          <span className="text-[#1D4ED8]">KU</span>
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#2563EB] ml-0.5 animate-pulse" />
        </div>
      )}
    </div>
  );
}
