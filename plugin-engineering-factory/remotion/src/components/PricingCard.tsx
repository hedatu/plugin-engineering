import React from "react";
import { resolveBrandTokens } from "../BrandTokens";

export const PricingCard: React.FC<{
  title: string;
  body: string;
  price: string;
  eyebrow?: string;
  bullets?: string[];
  footer?: string;
  tokens?: Partial<ReturnType<typeof resolveBrandTokens>>;
}> = ({ title, body, price, eyebrow, bullets = [], footer, tokens }) => {
  const palette = resolveBrandTokens(tokens);
  return (
  <div
    style={{
      padding: "30px 34px",
      borderRadius: 32,
      background: "#ffffff",
      border: `1px solid ${palette.primary}1f`,
      boxShadow: "0 22px 54px rgba(16, 32, 51, 0.14)"
    }}
  >
    {eyebrow ? (
      <div style={{ fontSize: 14, color: palette.primary, textTransform: "uppercase", letterSpacing: "0.12em" }}>{eyebrow}</div>
    ) : null}
    <div style={{ marginTop: eyebrow ? 12 : 0, fontSize: 22, color: palette.primary, textTransform: "uppercase", letterSpacing: "0.08em" }}>{title}</div>
    <div style={{ marginTop: 18, fontSize: 56, fontWeight: 700, color: palette.text, lineHeight: 0.95 }}>{price}</div>
    <div style={{ marginTop: 16, fontSize: 22, lineHeight: 1.5, color: `${palette.text}cc` }}>{body}</div>
    {bullets.length ? (
      <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
        {bullets.map((bullet) => (
          <div key={bullet} style={{ fontSize: 18, color: `${palette.text}cc` }}>{`• ${bullet}`}</div>
        ))}
      </div>
    ) : null}
    {footer ? (
      <div style={{ marginTop: 20, fontSize: 16, lineHeight: 1.5, color: `${palette.text}99` }}>{footer}</div>
    ) : null}
  </div>
  );
};
