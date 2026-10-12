import { type TerminalCapabilities } from "@opentui/core";

/** Minimal capability view needed to decide between image and text icons. */
export type ImageCapabilitySnapshot = Pick<
  TerminalCapabilities,
  "kitty_graphics" | "sixel"
> &
  Partial<Pick<TerminalCapabilities, "image_protocol" | "multiplexer">>;

/**
 * Whether the terminal can render raster icons. Terminals without Kitty or
 * Sixel support (and any host that still reports unknown capabilities) must
 * fall back to the direct text glyph.
 */
export function supportsImageRendering(
  capabilities: ImageCapabilitySnapshot | null | undefined,
): boolean {
  if (!capabilities || capabilities.image_protocol === "blocks") return false;
  if (
    capabilities.multiplexer === "tmux" &&
    capabilities.image_protocol !== "kitty" &&
    capabilities.image_protocol !== "sixel"
  ) {
    return false;
  }
  return capabilities.kitty_graphics || capabilities.sixel;
}
