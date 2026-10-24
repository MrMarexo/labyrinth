import { type ComponentProps } from "react";

import { Link as LocaleLink } from "~/i18n/navigation";
import { cn } from "~/lib/cn";

/* No underline; hover fades the colour a little. The transition itself is
   the global one on `a` in globals.css, so reduced motion turns it off. */
export const linkClassName = "text-fg hover:text-fg/70";

export function Link({
  className,
  ...props
}: ComponentProps<typeof LocaleLink>) {
  return <LocaleLink className={cn(linkClassName, className)} {...props} />;
}
