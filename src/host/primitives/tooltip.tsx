import * as RT from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";

/** Mount once at the root. 400 ms open delay; moving between tooltips skips it. */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RT.Provider delayDuration={400} skipDelayDuration={300}>
      {children}
    </RT.Provider>
  );
}

/** An inverted tooltip on any focusable child. The child must accept a ref (Button does). */
export function Tooltip({ content, children, side = "top" }: { content: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <RT.Root>
      <RT.Trigger asChild>{children}</RT.Trigger>
      <RT.Portal>
        <RT.Content className="tooltip" side={side} sideOffset={6} collisionPadding={8}>
          {content}
          <RT.Arrow className="tooltip-arrow" width={10} height={5} />
        </RT.Content>
      </RT.Portal>
    </RT.Root>
  );
}
