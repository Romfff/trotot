"use client";

import { Command as CommandPrimitive } from "cmdk";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

export const Command = forwardRef<ElementRef<typeof CommandPrimitive>, ComponentPropsWithoutRef<typeof CommandPrimitive>>(
  ({ className, ...props }, ref) => <CommandPrimitive ref={ref} className={cn("w-full overflow-hidden rounded-2xl bg-white text-foreground", className)} {...props} />,
);
Command.displayName = "Command";
export const CommandInput = forwardRef<ElementRef<typeof CommandPrimitive.Input>, ComponentPropsWithoutRef<typeof CommandPrimitive.Input>>(
  ({ className, ...props }, ref) => <CommandPrimitive.Input ref={ref} className={cn("h-11 w-full border-b border-gray-200 bg-white px-3 text-base outline-none placeholder:text-gray-600", className)} {...props} />,
);
CommandInput.displayName = "CommandInput";
export const CommandList = forwardRef<ElementRef<typeof CommandPrimitive.List>, ComponentPropsWithoutRef<typeof CommandPrimitive.List>>(
  ({ className, ...props }, ref) => <CommandPrimitive.List ref={ref} className={cn("max-h-60 overflow-y-auto overflow-x-hidden p-1", className)} {...props} />,
);
CommandList.displayName = "CommandList";
export const CommandEmpty = CommandPrimitive.Empty;
export const CommandItem = forwardRef<ElementRef<typeof CommandPrimitive.Item>, ComponentPropsWithoutRef<typeof CommandPrimitive.Item>>(
  ({ className, ...props }, ref) => <CommandPrimitive.Item ref={ref}
    className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-xl px-3 py-2 text-sm outline-none data-[selected=true]:bg-brand-tint data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50", className)} {...props} />,
);
CommandItem.displayName = "CommandItem";
