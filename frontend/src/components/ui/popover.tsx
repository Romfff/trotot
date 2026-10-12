"use client";

import * as PopoverPrimitive from "@radix-ui/react-popover";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from "react";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;
export const PopoverContent = forwardRef<ElementRef<typeof PopoverPrimitive.Content>, ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>>(
  ({ className, align = "start", sideOffset = 8, ...props }, ref) => <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content ref={ref} align={align} sideOffset={sideOffset} collisionPadding={16}
      className={cn("address-popover z-[600] w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] rounded-2xl border border-gray-200 bg-white shadow-sm", className)} {...props} />
  </PopoverPrimitive.Portal>,
);
PopoverContent.displayName = "PopoverContent";
