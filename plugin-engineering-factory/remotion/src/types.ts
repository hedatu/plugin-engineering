export type BrandTypography = {
  headline_family: string;
  body_family: string;
  display_style?: string;
  note?: string;
};

export type BrandPalette = {
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
};

export type ScreenshotAsset = {
  file_name: string;
  path: string;
  image_data_url?: string;
};

export type StoryboardEntry = {
  screenshot_id: string;
  title: string;
  user_question_answered: string;
  source_real_screenshot: string;
  overlay_headline: string;
  overlay_subcopy: string;
  feature_shown: string;
  trust_signal: string;
  expected_file: string;
  chrome_store_compliance_notes: string;
  image_data_url?: string;
};

export type MonetizationPreview = {
  enabled: boolean;
  free_limit: string;
  lifetime_unlock: string;
  disclosure: string;
};

export type PackagingClaims = {
  local_only: string;
  no_login: string;
  no_upload: string;
  no_cloud_sync: string;
  minimal_permissions: string;
};

export type PackagingAssetTarget = {
  kind: "store_screenshot" | "promo_tile" | "marquee" | "landing_hero" | "pricing_hero" | "short_video";
  index?: number;
};

export type PackagingProps = {
  run_id: string;
  product_slug: string;
  product_name: string;
  short_name: string;
  tagline: string;
  one_sentence_value: string;
  trust_positioning: string;
  brand: {
    palette: BrandPalette;
    typography: BrandTypography;
  };
  claims: PackagingClaims;
  storyboard: StoryboardEntry[];
  screenshots: ScreenshotAsset[];
  monetization_preview: MonetizationPreview;
  browser_executable?: string | null;
  asset?: PackagingAssetTarget;
};

export const defaultPackagingProps: PackagingProps = {
  run_id: "sample-run",
  product_slug: "sample-product",
  product_name: "Sample Product",
  short_name: "Sample",
  tagline: "Save once. Fill cleanly.",
  one_sentence_value: "Save one local profile and fill visible fields on the active page.",
  trust_positioning: "Local-only, low-permission, and user-triggered.",
  brand: {
    palette: {
      primary: "#17324D",
      secondary: "#B9D8E8",
      accent: "#13836F",
      background: "#EEF4F7",
      text: "#102233"
    },
    typography: {
      headline_family: "\"Segoe UI Variable Display\", \"Segoe UI\", sans-serif",
      body_family: "\"Segoe UI Variable Text\", \"Segoe UI\", sans-serif"
    }
  },
  claims: {
    local_only: "Local-only storage.",
    no_login: "No login required.",
    no_upload: "No upload of saved profile data.",
    no_cloud_sync: "No cloud sync.",
    minimal_permissions: "Uses only storage, activeTab, and scripting."
  },
  storyboard: [],
  screenshots: [],
  monetization_preview: {
    enabled: false,
    free_limit: "",
    lifetime_unlock: "",
    disclosure: ""
  },
  browser_executable: null,
  asset: {
    kind: "store_screenshot",
    index: 0
  }
};
