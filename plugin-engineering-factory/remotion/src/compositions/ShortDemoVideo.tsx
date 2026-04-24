import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { resolveBrandTokens } from "../BrandTokens";
import { BrowserFrame } from "../components/BrowserFrame";
import { FeatureCallout } from "../components/FeatureCallout";
import { GradientBackground } from "../components/GradientBackground";
import { ScreenshotLayer } from "../components/ScreenshotLayer";
import type { PackagingProps } from "../types";

export const ShortDemoVideo: React.FC<PackagingProps> = (props) => {
  const palette = resolveBrandTokens(props.brand?.palette);
  const popup = props.storyboard?.[0]?.image_data_url ?? props.screenshots?.[0]?.image_data_url;
  const before = props.storyboard?.[1]?.image_data_url ?? props.screenshots?.[1]?.image_data_url ?? popup;
  const result = props.storyboard?.[2]?.image_data_url ?? props.screenshots?.[2]?.image_data_url ?? popup;

  return (
    <AbsoluteFill style={{ padding: 48, fontFamily: props.brand?.typography?.body_family ?? "\"Segoe UI Variable Text\", \"Segoe UI\", sans-serif" }}>
      <GradientBackground tokens={palette} />
      <Sequence from={0} durationInFrames={120}>
        <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
          <FeatureCallout
            eyebrow={props.product_name}
            title="Save one local profile."
            body="Keep repeat contact details ready in the popup."
            tokens={palette}
            badges={["Local-only", "No login"]}
            maxWidth={520}
          />
        </div>
      </Sequence>
      <Sequence from={120} durationInFrames={150}>
        <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
          <BrowserFrame tokens={palette}>
            <div style={{ width: 980, height: 560 }}>
              <ScreenshotLayer src={before} fit="cover" />
            </div>
          </BrowserFrame>
        </div>
      </Sequence>
      <Sequence from={270} durationInFrames={180}>
        <div style={{ display: "grid", gridTemplateColumns: "0.88fr 1.12fr", gap: 28, alignItems: "center", height: "100%" }}>
          <FeatureCallout
            title="Fill cleanly and keep control."
            body="Visible fields only, overwrite stays off by default, and the workflow ends with a real result frame."
            badges={["Browser-smoke proof", "Minimal permissions"]}
            tokens={palette}
            maxWidth={520}
          />
          <BrowserFrame tokens={palette}>
            <div style={{ width: 920, height: 520 }}>
              <ScreenshotLayer src={result} fit="cover" />
            </div>
          </BrowserFrame>
        </div>
      </Sequence>
      <Sequence from={430} durationInFrames={20}>
        <div />
      </Sequence>
    </AbsoluteFill>
  );
};
