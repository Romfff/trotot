import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string; hint?: string };

export function Input({ id, label, error, hint, className, ...props }: InputProps) {
  const inputId = id || props.name;
  const helpId = inputId + "-help";
  return (
    <div className="field">
      <Label htmlFor={inputId}>{label}</Label>
      <input
        id={inputId}
        className={cn("field-control", className)}
        aria-invalid={Boolean(error)}
        aria-describedby={error || hint ? helpId : undefined}
        {...props}
      />
      {error ? <p className="field-error" id={helpId}>{error}</p> : hint ? <p className="password-rules" id={helpId}>{hint}</p> : null}
    </div>
  );
}
