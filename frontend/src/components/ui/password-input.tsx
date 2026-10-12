"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

type PasswordInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  error?: string;
  requireLetterAndNumber?: boolean;
};

export function PasswordInput({ id, name, label, error, className, requireLetterAndNumber, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  const inputId = id || name;
  const errorId = inputId + "-error";
  return <div className="field">
    <Label htmlFor={inputId}>{label}</Label>
    <div className="input-wrap">
      <input
        {...props}
        id={inputId}
        name={name}
        className={cn("field-control", className)}
        type={visible ? "text" : "password"}
        autoComplete={props.autoComplete || "current-password"}
        minLength={props.minLength ?? 8}
        maxLength={props.maxLength ?? 64}
        pattern={requireLetterAndNumber ? "(?=.*[A-Za-z])(?=.*[0-9]).+" : props.pattern}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
      />
      <button className="input-action" type="button" onClick={() => setVisible((value) => !value)} aria-label={visible ? "Ẩn mật khẩu" : "Hiện mật khẩu"} aria-pressed={visible}>
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button>
    </div>
    {error ? <p className="field-error" id={errorId}>{error}</p> : null}
  </div>;
}
