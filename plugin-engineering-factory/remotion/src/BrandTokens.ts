import type { BrandPalette } from "./types";

export type BrandTokens = BrandPalette;

export const defaultBrandTokens: BrandTokens = {
  primary: "#123B66",
  secondary: "#8EC5E8",
  accent: "#11A88C",
  background: "#F3F7FB",
  text: "#102033"
};

export const resolveBrandTokens = (input?: Partial<BrandTokens>): BrandTokens => ({
  ...defaultBrandTokens,
  ...(input ?? {})
});
