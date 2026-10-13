import { usePlugin } from "@opencode/plugin/tui";
import { RGBA, rgbToHex, type TerminalCapabilities } from "@opentui/core";
import { type ImageProps } from "@opentui/solid";
import { Resvg } from "@resvg/resvg-js";
import {
  createMemo,
  createSignal,
  onCleanup,
  Show,
  splitProps,
} from "solid-js";
import { supportsImageRendering } from "./image-capabilities";

export function SvgIcon(
  props: ImageProps & {
    source: string;
    color?: RGBA | string;
    fallback: string;
  },
) {
  // Solid props are getters. Destructuring them reads each value exactly once
  // at creation time, which freezes the prop instead of tracking it. That made
  // the collapsed `▶` / expanded `▼` fallback glyph stick on terminals without
  // image support, where the text fallback is the branch that renders.
  // splitProps keeps every accessor live while still separating the props this
  // component consumes from the ones forwarded to the rendered element.
  const [local, rest] = splitProps(props, ["source", "color", "fallback"]);
  const context = usePlugin();
  const [imageSupported, setImageSupported] = createSignal(
    supportsImageRendering(context.renderer.capabilities),
  );
  const updateImageSupport = (capabilities: TerminalCapabilities) => {
    setImageSupported(supportsImageRendering(capabilities));
  };

  context.renderer.on("capabilities", updateImageSupport);
  onCleanup(() => context.renderer.off("capabilities", updateImageSupport));

  const iconColor = () =>
    local.color
      ? typeof local.color === "string"
        ? local.color
        : rgbToHex(local.color)
      : "currentColor";

  const pngBuffer = createMemo(() => {
    const bgToken = context.theme.background.base;
    const bg = rgbToHex(bgToken);

    let svg = local.source
      .replace(/stroke="[^"]*"/g, `stroke="${iconColor()}"`)
      .replace(/color="[^"]*"/g, `color="${iconColor()}"`);

    const resvg = new Resvg(svg, {
      fitTo: { mode: "width", value: 64 },
      background: bg,
    });
    return resvg.render().asPng();
  });

  return (
    <Show
      when={imageSupported()}
      fallback={
        <text>
          <span style={{ fg: iconColor() }}>{local.fallback}</span>
        </text>
      }
    >
      <image
        source={pngBuffer()}
        width={props.width ?? 2}
        height={props.height ?? 1}
        {...rest}
      />
    </Show>
  );
}
