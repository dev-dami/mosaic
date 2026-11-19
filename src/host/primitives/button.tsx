import type { ButtonHTMLAttributes, MouseEvent, ReactNode, Ref } from "react";
import { Tooltip } from "./tooltip";

export type ButtonVariant = "primary" | "secondary" | "tertiary" | "danger";
export type ButtonSize = "xs" | "sm" | "md" | "lg";

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "disabled"> & {
  /** primary: the one chunky action of an area. secondary: other 3D actions. tertiary: flat. danger: destructive. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon (a Phosphor icon element). */
  icon?: ReactNode;
  /** Trailing icon or keyboard hint. */
  side?: ReactNode;
  /**
   * Why the button cannot be used right now. When set, the button stays visible and focusable,
   * gets aria-disabled, ignores clicks, and shows the reason in a tooltip. Buttons are never
   * quietly disabled.
   */
  disabledReason?: string | null | false;
  ref?: Ref<HTMLButtonElement>;
};

/** The 3D button: a face on a hard ledge that lifts on hover and sinks on press. */
export function Button({ variant = "secondary", size = "md", icon, side, disabledReason, className, onClick, children, type = "button", ref, ...rest }: ButtonProps) {
  const off = !!disabledReason;
  const button = (
    <button
      {...rest}
      ref={ref}
      type={type}
      className={`btn btn--${variant} btn--${size} ${className ?? ""}`}
      aria-disabled={off || undefined}
      onClick={(e: MouseEvent<HTMLButtonElement>) => {
        if (off) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
    >
      {icon}
      {children !== undefined && <span className="btn-label">{children}</span>}
      {side}
    </button>
  );
  return off ? <Tooltip content={disabledReason}>{button}</Tooltip> : button;
}
