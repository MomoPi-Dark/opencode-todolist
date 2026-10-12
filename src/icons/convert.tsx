import { usePlugin } from "@opencode/plugin/tui";
import { RGBA, rgbToHex, type TerminalCapabilities } from "@opentui/core";
import { type ImageProps } from "@opentui/solid";
import { Resvg } from "@resvg/resvg-js";
import { createMemo, createSignal, onCleanup, Show } from "solid-js";
import { supportsImageRendering } from "./capabilities";

export function SvgIcon(
  props: ImageProps & {
    source: string;
    color: RGBA | string;
    fallback: string;
  },
) {
  const { source: _, color: __, fallback, ...prop } = props;
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
    typeof props.color === "string" ? props.color : rgbToHex(props.color);

  const pngBuffer = createMemo(() => {
    const bgToken = context.theme.background.base;
    const bg = rgbToHex(bgToken);

    const svg = props.source
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
          <span style={{ fg: iconColor() }}>{fallback}</span>
        </text>
      }
    >
      <image
        source={pngBuffer()}
        width={props.width ?? 2}
        height={props.height ?? 1}
        {...prop}
      />
    </Show>
  );
}
