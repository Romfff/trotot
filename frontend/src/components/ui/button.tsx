import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "",
      primary: "",
      secondary: "button-secondary",
      plain: "button-plain",
    },
    size: {
      default: "",
      sm: "button-sm",
      lg: "button-lg",
      icon: "button-icon",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants> & { children: ReactNode };

export function Button({ variant, size, className, children, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props}>{children}</button>;
}

export { buttonVariants };
