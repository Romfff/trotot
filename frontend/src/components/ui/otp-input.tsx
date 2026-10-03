"use client";

import { useState, type InputHTMLAttributes } from "react";
import { Label } from "@/components/ui/label";

type OtpInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode" | "autoComplete" | "value" | "defaultValue" | "onChange"> & {
  label: string;
  error?: string;
};

export function OtpInput({ label, error, id, ...props }: OtpInputProps) {
  const [code, setCode] = useState("");
  const [focused, setFocused] = useState(false);
  const [position, setPosition] = useState(0);
  const inputId = id || props.name;
  const helpId = inputId + "-help";

  return <div className="field">
    <Label htmlFor={inputId}>{label}</Label>
    <div className="otp-entry">
      {/* One real input preserves paste, keyboard editing and mobile OTP autofill. */}
      <input
        {...props}
        id={inputId}
        className="otp-input"
        type="text"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        minLength={6}
        maxLength={6}
        value={code}
        aria-invalid={Boolean(error)}
        aria-describedby={helpId}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onSelect={(event) => setPosition(event.currentTarget.selectionStart ?? code.length)}
        onPointerDown={(event) => {
          event.preventDefault();
          const input = event.currentTarget;
          const bounds = input.getBoundingClientRect();
          const index = Math.min(code.length, 5, Math.max(0, Math.floor((event.clientX - bounds.left) / (bounds.width / 6))));
          input.focus();
          input.setSelectionRange(index, Math.min(index + 1, code.length));
          setPosition(index);
        }}
        onChange={(event) => {
          const next = event.target.value.replace(/\D/g, "").slice(0, 6);
          setCode(next);
          setPosition(Math.min(event.currentTarget.selectionStart ?? next.length, next.length));
        }}
        onPaste={(event) => {
          event.preventDefault();
          const next = event.clipboardData.getData("text").replace(/\D/g, "").slice(0, 6);
          setCode(next);
          setPosition(next.length);
        }}
      />
      <div className="otp-slots" aria-hidden="true">
        {Array.from({ length: 6 }, (_, index) => <span
          key={index}
          className="otp-slot"
          data-active={focused && index === Math.min(position, 5)}
          data-invalid={Boolean(error)}
        >{code[index] || ""}</span>)}
      </div>
    </div>
    <p className={error ? "field-error" : "password-rules"} id={helpId}>{error || "Nhập đủ 6 chữ số trong mã xác thực."}</p>
  </div>;
}
