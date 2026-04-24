import React from "react";
import { AbsoluteFill } from "remotion";
import { resolveBrandTokens } from "../BrandTokens";

export const GradientBackground: React.FC<{ tokens?: Partial<ReturnType<typeof resolveBrandTokens>> }> = ({ tokens }) => {
  const palette = resolveBrandTokens(tokens);
  return (
  <AbsoluteFill
    style={{
      background: [
        `radial-gradient(circle at top left, ${palette.secondary}88, transparent 32%)`,
        `radial-gradient(circle at bottom right, ${palette.accent}18, transparent 26%)`,
        `linear-gradient(180deg, #ffffff 0%, ${palette.background} 100%)`
      ].join(", ")
    }}
  />
  );
};
