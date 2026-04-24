import React from "react";
import { resolveBrandTokens } from "../BrandTokens";

export const FeatureCallout: React.FC<{
  title: string;
  body: string;
  eyebrow?: string;
  badges?: string[];
  tokens?: Partial<ReturnType<typeof resolveBrandTokens>>;
  maxWidth?: number;
}> = ({ title, body, eyebrow, badges = [], tokens, maxWidth = 420 }) => {
  const palette = resolveBrandTokens(tokens);
  return (
  <div
    style={{
      maxWidth,
      padding: "28px 30px",
      borderRadius: 28,
      background: "#fffffff2",
      border: `1px solid ${palette.primary}18`,
      boxShadow: "0 18px 44px rgba(16, 32, 51, 0.11)"
    }}
  >
    {eyebrow ? (
      <div style={{ marginBottom: 14, fontSize: 14, letterSpacing: "0.12em", textTransform: "uppercase", color: palette.primary }}>
        {eyebrow}
      </div>
    ) : null}
    <div style={{ fontSize: 36, lineHeight: 1.08, fontWeight: 700, color: palette.text }}>{title}</div>
    <div style={{ marginTop: 14, fontSize: 20, lineHeight: 1.5, color: `${palette.text}cc` }}>{body}</div>
    {badges.length ? (
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 20 }}>
        {badges.map((badge) => (
          <span
            key={badge}
            style={{
              padding: "8px 12px",
              borderRadius: 999,
              background: `${palette.secondary}55`,
              color: palette.primary,
              fontSize: 14,
              fontWeight: 600
            }}
          >
            {badge}
          </span>
        ))}
      </div>
    ) : null}
  </div>
  );
};
