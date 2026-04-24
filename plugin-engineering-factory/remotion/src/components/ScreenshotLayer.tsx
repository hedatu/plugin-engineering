import React from "react";

export const ScreenshotLayer: React.FC<{ src?: string; fit?: "cover" | "contain" }> = ({ src, fit = "cover" }) => (
  src ? (
    <img
      src={src}
      style={{
        width: "100%",
        height: "100%",
        objectFit: fit,
        display: "block"
      }}
    />
  ) : (
    <div
      style={{
        width: "100%",
        height: "100%",
        background: "linear-gradient(135deg, #d8e4ef, #f5f7fa)"
      }}
    />
  )
);
