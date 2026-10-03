import type { ReactNode } from "react";
import { cva } from "class-variance-authority";
import { cn } from "@/lib/utils";

const alertVariants = cva("", {
  variants: {
    tone: {
      error: "form-error",
      success: "form-success",
      notice: "notice",
    },
  },
  defaultVariants: { tone: "error" },
});

export function Alert({ children, tone = "error", className }: { children: ReactNode; tone?: "error" | "success" | "notice"; className?: string }) {
  return <p role={tone === "error" ? "alert" : "status"} aria-live="polite" className={cn(alertVariants({ tone }), className)}>{children}</p>;
}
