import React from "react";
import { AbsoluteFill } from "remotion";
import { resolveBrandTokens } from "../BrandTokens";
import { BrowserFrame } from "../components/BrowserFrame";
import { FeatureCallout } from "../components/FeatureCallout";
import { GradientBackground } from "../components/GradientBackground";
import { ProductBadge } from "../components/ProductBadge";
import { ScreenshotLayer } from "../components/ScreenshotLayer";
import type { PackagingProps } from "../types";

export const StoreScreenshot: React.FC<PackagingProps> = (props) => {
  const palette = resolveBrandTokens(props.brand?.palette);
  const entry = props.storyboard?.[props.asset?.index ?? 0] ?? props.storyboard?.[0];

  return (
    <AbsoluteFill
      style={{
        padding: 44,
        fontFamily: props.brand?.typography?.body_family ?? "\"Segoe UI Variable Text\", \"Segoe UI\", sans-serif"
      }}
    >
      <GradientBackground tokens={palette} />
      <div style={{ position: "relative", width: "100%", height: "100%" }}>
        <div style={{ position: "absolute", left: 0, top: 78, width: 404 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <ProductBadge text={entry?.feature_shown ?? props.short_name} tokens={palette} />
            <FeatureCallout
              eyebrow={props.product_name}
              title={entry?.overlay_headline ?? props.tagline}
              body={entry?.overlay_subcopy ?? props.one_sentence_value}
              badges={[entry?.trust_signal ?? "Real UI proof", "Browser-smoke capture"]}
              tokens={palette}
              maxWidth={404}
            />
            <div style={{ fontSize: 18, color: `${palette.text}aa`, lineHeight: 1.6, maxWidth: 390 }}>
              {entry?.user_question_answered ?? props.trust_positioning}
            </div>
          </div>
        </div>
        <div style={{ position: "absolute", right: 0, top: 86, width: 774 }}>
          <BrowserFrame tokens={palette}>
            <div style={{ width: 774, height: 484, background: "#ffffff" }}>
              <ScreenshotLayer src={entry?.image_data_url ?? props.screenshots?.[0]?.image_data_url} fit="cover" />
            </div>
          </BrowserFrame>
        </div>
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 24, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 17, color: `${palette.text}aa` }}>{props.claims?.minimal_permissions ?? ""}</div>
          <div style={{ fontSize: 16, color: palette.primary }}>Real UI screenshot</div>
        </div>
      </div>
    </AbsoluteFill>
  );
};
