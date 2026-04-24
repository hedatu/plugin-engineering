import React from "react";
import { Composition } from "remotion";
import { StoreScreenshot } from "./compositions/StoreScreenshot";
import { PromoTile440x280 } from "./compositions/PromoTile440x280";
import { Marquee1400x560 } from "./compositions/Marquee1400x560";
import { LandingHero } from "./compositions/LandingHero";
import { PricingHero } from "./compositions/PricingHero";
import { ShortDemoVideo } from "./compositions/ShortDemoVideo";
import { defaultPackagingProps } from "./types";

export const Root: React.FC = () => (
  <>
    <Composition id="StoreScreenshot" component={StoreScreenshot} durationInFrames={1} fps={30} width={1280} height={800} defaultProps={defaultPackagingProps} />
    <Composition id="PromoTile440x280" component={PromoTile440x280} durationInFrames={1} fps={30} width={440} height={280} defaultProps={defaultPackagingProps} />
    <Composition id="Marquee1400x560" component={Marquee1400x560} durationInFrames={1} fps={30} width={1400} height={560} defaultProps={defaultPackagingProps} />
    <Composition id="LandingHero" component={LandingHero} durationInFrames={1} fps={30} width={1600} height={900} defaultProps={defaultPackagingProps} />
    <Composition id="PricingHero" component={PricingHero} durationInFrames={1} fps={30} width={1600} height={900} defaultProps={defaultPackagingProps} />
    <Composition id="ShortDemoVideo" component={ShortDemoVideo} durationInFrames={450} fps={30} width={1600} height={900} defaultProps={defaultPackagingProps} />
  </>
);
