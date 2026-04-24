import React from "react";
import { AbsoluteFill } from "remotion";
import { resolveBrandTokens } from "../BrandTokens";
import { BrowserFrame } from "../components/BrowserFrame";
import { GradientBackground } from "../components/GradientBackground";
import { ProductBadge } from "../components/ProductBadge";
import { ScreenshotLayer } from "../components/ScreenshotLayer";
import type { PackagingProps } from "../types";

export const PromoTile440x280: React.FC<PackagingProps> = (props) => {
  const palette = resolveBrandTokens(props.brand?.palette);
  const source = props.storyboard?.[0]?.image_data_url ?? props.screenshots?.[0]?.image_data_url;

  return (
    <AbsoluteFill
      style={{
        padding: 24,
        fontFamily: props.brand?.typography?.body_family ?? "\"Segoe UI Variable Text\", \"Segoe UI\", sans-serif"
      }}
    >
      <GradientBackground tokens={palette} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.05fr 0.95fr",
          gap: 14,
          height: "100%",
          alignItems: "center"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <ProductBadge text={props.short_name} tokens={palette} />
          <div style={{ fontSize: 30, lineHeight: 1.02, fontWeight: 700, color: palette.text }}>{props.tagline}</div>
          <div style={{ fontSize: 16, lineHeight: 1.4, color: `${palette.text}cc` }}>Local-only form fill for repetitive lead pages.</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {["No login", "No cloud sync"].map((badge) => (
              <span
                key={badge}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  background: `${palette.secondary}66`,
                  color: palette.primary,
                  fontSize: 12,
                  fontWeight: 600
                }}
              >
                {badge}
              </span>
            ))}
          </div>
        </div>
        <div style={{ position: "relative", height: "100%" }}>
          <div
            style={{
              position: "absolute",
              inset: "20px 0 0 14px",
              borderRadius: 26,
              background: `linear-gradient(135deg, ${palette.primary}12, ${palette.accent}12)`
            }}
          />
          <div style={{ position: "absolute", right: 0, top: 12, width: 190 }}>
            <BrowserFrame tokens={palette}>
              <div style={{ width: 190, height: 136, background: "#ffffff" }}>
                <ScreenshotLayer src={source} fit="cover" />
              </div>
            </BrowserFrame>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
