import React from "react";
import { resolveBrandTokens } from "../BrandTokens";

export const ProductBadge: React.FC<{
  text: string;
  tokens?: Partial<ReturnType<typeof resolveBrandTokens>>;
}> = ({ text, tokens }) => {
  const palette = resolveBrandTokens(tokens);
  return (
  <div
    style={{
      display: "inline-block",
      padding: "10px 16px",
      borderRadius: 999,
      background: "#ffffffcc",
      border: `1px solid ${palette.primary}22`,
      color: palette.primary,
      fontSize: 18,
      fontWeight: 600,
      letterSpacing: "0.1em",
      textTransform: "uppercase"
    }}
  >
    {text}
  </div>
  );
};
