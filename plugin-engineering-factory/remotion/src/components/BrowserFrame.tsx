import React from "react";
import { resolveBrandTokens } from "../BrandTokens";

export const BrowserFrame: React.FC<React.PropsWithChildren<{ tokens?: Partial<ReturnType<typeof resolveBrandTokens>> }>> = ({ children, tokens }) => {
  const palette = resolveBrandTokens(tokens);
  return (
  <div
    style={{
      borderRadius: 28,
      overflow: "hidden",
      background: "#ffffff",
      border: `1px solid ${palette.primary}20`,
      boxShadow: "0 24px 60px rgba(16, 32, 51, 0.14)"
    }}
  >
    <div
      style={{
        display: "flex",
        gap: 10,
        padding: "16px 20px",
        borderBottom: `1px solid ${palette.primary}12`,
        background: "rgba(255,255,255,0.96)"
      }}
    >
      <span style={{ width: 12, height: 12, borderRadius: 12, background: "#ef4444" }} />
      <span style={{ width: 12, height: 12, borderRadius: 12, background: "#f59e0b" }} />
      <span style={{ width: 12, height: 12, borderRadius: 12, background: "#10b981" }} />
    </div>
    {children}
  </div>
  );
};
