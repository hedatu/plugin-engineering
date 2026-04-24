import React from "react";
import { AbsoluteFill } from "remotion";
import { resolveBrandTokens } from "../BrandTokens";
import { BrowserFrame } from "../components/BrowserFrame";
import { FeatureCallout } from "../components/FeatureCallout";
import { GradientBackground } from "../components/GradientBackground";
import { ProductBadge } from "../components/ProductBadge";
import { ScreenshotLayer } from "../components/ScreenshotLayer";
import type { PackagingProps } from "../types";

export const Marquee1400x560: React.FC<PackagingProps> = (props) => {
  const palette = resolveBrandTokens(props.brand?.palette);
  const popup = props.storyboard?.[0]?.image_data_url ?? props.screenshots?.[0]?.image_data_url;
  const result = props.storyboard?.[2]?.image_data_url ?? props.screenshots?.[2]?.image_data_url ?? popup;

  return (
    <AbsoluteFill
      style={{
        padding: 40,
        fontFamily: props.brand?.typography?.body_family ?? "\"Segoe UI Variable Text\", \"Segoe UI\", sans-serif"
      }}
    >
      <GradientBackground tokens={palette} />
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "0.88fr 1.12fr",
          gap: 28,
          height: "100%",
          alignItems: "center"
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <ProductBadge text="Single-purpose form fill" tokens={palette} />
          <FeatureCallout
            title="A focused form-fill tool with fewer permissions."
            body="Save one local profile, fill visible lead fields from the popup, and keep the trust story plain."
            badges={["Local-only", "No login", "No cloud sync"]}
            tokens={palette}
            maxWidth={480}
          />
        </div>
        <div style={{ position: "relative", height: "100%" }}>
          <div style={{ position: "absolute", right: 0, top: 30, width: 760 }}>
            <BrowserFrame tokens={palette}>
              <div style={{ width: 760, height: 430, background: "#ffffff" }}>
                <ScreenshotLayer src={result} fit="cover" />
              </div>
            </BrowserFrame>
          </div>
          <div style={{ position: "absolute", left: 20, bottom: 18, width: 330 }}>
            <BrowserFrame tokens={palette}>
              <div style={{ width: 330, height: 218, background: "#ffffff" }}>
                <ScreenshotLayer src={popup} fit="cover" />
              </div>
            </BrowserFrame>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
