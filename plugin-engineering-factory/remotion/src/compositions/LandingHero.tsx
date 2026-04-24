import React from "react";
import { AbsoluteFill } from "remotion";
import { resolveBrandTokens } from "../BrandTokens";
import { BrowserFrame } from "../components/BrowserFrame";
import { FeatureCallout } from "../components/FeatureCallout";
import { GradientBackground } from "../components/GradientBackground";
import { ProductBadge } from "../components/ProductBadge";
import { ScreenshotLayer } from "../components/ScreenshotLayer";
import type { PackagingProps } from "../types";

export const LandingHero: React.FC<PackagingProps> = (props) => {
  const palette = resolveBrandTokens(props.brand?.palette);
  const popup = props.storyboard?.[0]?.image_data_url ?? props.screenshots?.[0]?.image_data_url;
  const before = props.storyboard?.[1]?.image_data_url ?? props.screenshots?.[1]?.image_data_url ?? popup;
  const result = props.storyboard?.[2]?.image_data_url ?? props.screenshots?.[2]?.image_data_url ?? popup;

  return (
    <AbsoluteFill
      style={{
        padding: 58,
        fontFamily: props.brand?.typography?.body_family ?? "\"Segoe UI Variable Text\", \"Segoe UI\", sans-serif"
      }}
    >
      <GradientBackground tokens={palette} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.92fr 1.08fr",
          gap: 34,
          height: "100%",
          alignItems: "center"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
          <ProductBadge text="Chrome extension" tokens={palette} />
          <div style={{ fontSize: 76, lineHeight: 0.94, fontWeight: 700, color: palette.text, maxWidth: 620 }}>{props.product_name}</div>
          <div style={{ fontSize: 28, lineHeight: 1.42, color: `${palette.text}d0`, maxWidth: 620 }}>{props.one_sentence_value}</div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {["Local-only", "No login", "No cloud sync", "Minimal permissions"].map((badge) => (
              <span
                key={badge}
                style={{
                  padding: "10px 14px",
                  borderRadius: 999,
                  background: "#ffffffd8",
                  border: `1px solid ${palette.primary}18`,
                  color: palette.primary,
                  fontSize: 16,
                  fontWeight: 600
                }}
              >
                {badge}
              </span>
            ))}
          </div>
          <FeatureCallout
            eyebrow="Real workflow"
            title="Save. Fill. Keep it controlled."
            body="The extension stays narrow: one local profile, one active tab, and clear overwrite protection by default."
            tokens={palette}
            maxWidth={560}
          />
        </div>
        <div style={{ position: "relative", height: "100%" }}>
          <div style={{ position: "absolute", right: 0, top: 40, width: 860 }}>
            <BrowserFrame tokens={palette}>
              <div style={{ width: 860, height: 510, background: "#ffffff" }}>
                <ScreenshotLayer src={result} fit="cover" />
              </div>
            </BrowserFrame>
          </div>
          <div style={{ position: "absolute", left: 16, top: 0, width: 360 }}>
            <BrowserFrame tokens={palette}>
              <div style={{ width: 360, height: 238, background: "#ffffff" }}>
                <ScreenshotLayer src={popup} fit="cover" />
              </div>
            </BrowserFrame>
          </div>
          <div style={{ position: "absolute", left: 80, bottom: 0, width: 430 }}>
            <BrowserFrame tokens={palette}>
              <div style={{ width: 430, height: 250, background: "#ffffff" }}>
                <ScreenshotLayer src={before} fit="cover" />
              </div>
            </BrowserFrame>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
