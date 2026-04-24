import React from "react";
import { AbsoluteFill } from "remotion";
import { resolveBrandTokens } from "../BrandTokens";
import { BrowserFrame } from "../components/BrowserFrame";
import { GradientBackground } from "../components/GradientBackground";
import { PricingCard } from "../components/PricingCard";
import { ScreenshotLayer } from "../components/ScreenshotLayer";
import type { PackagingProps } from "../types";

export const PricingHero: React.FC<PackagingProps> = (props) => {
  const palette = resolveBrandTokens(props.brand?.palette);
  const popup = props.storyboard?.[0]?.image_data_url ?? props.screenshots?.[0]?.image_data_url;
  const previewEnabled = Boolean(props.monetization_preview?.enabled);

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
          gridTemplateColumns: "1.04fr 0.96fr",
          gap: 34,
          alignItems: "center",
          height: "100%"
        }}
      >
        <PricingCard
          eyebrow={previewEnabled ? "Pricing disclosure" : "Truthful scope"}
          title={previewEnabled ? "Free path and lifetime unlock" : "Current sandbox build is free-only"}
          price={previewEnabled ? props.monetization_preview.lifetime_unlock : "Free"}
          body={previewEnabled
            ? "Only enable pricing visuals when the extension actually ships the free limit and unlock flow."
            : "Do not imply an upgrade path before the extension actually ships monetization."}
          bullets={previewEnabled
            ? [props.monetization_preview.free_limit, "Show paid limits in the UI", "Keep checkout outside the extension"]
            : ["Local-only storage", "No login", "No cloud sync"]}
          footer={previewEnabled
            ? props.monetization_preview.disclosure
            : "If monetization is added later, disclose the free path, lifetime unlock, and license flow before release."}
          tokens={palette}
        />
        <div style={{ position: "relative", height: "100%" }}>
          <div
            style={{
              position: "absolute",
              inset: "44px 0 44px 46px",
              borderRadius: 36,
              background: `linear-gradient(135deg, ${palette.primary}10, ${palette.secondary}18)`
            }}
          />
          <div style={{ position: "absolute", right: 24, top: 70, width: 600 }}>
            <BrowserFrame tokens={palette}>
              <div style={{ width: 600, height: 420, background: "#ffffff" }}>
                <ScreenshotLayer src={popup} fit="cover" />
              </div>
            </BrowserFrame>
          </div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
