"use client";

import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { filterAddressOptions, type AddressOption } from "@/lib/address-search";

type Props = { name: string; label: string; items: AddressOption[]; value: string; onChange: (value: string) => void; disabled?: boolean; hint?: string; error?: string; loading?: boolean };

export function AddressCombobox({ name, label, items, value, onChange, disabled, hint, error, loading }: Props) {
  const [open, setOpen] = useState(false); const [query, setQuery] = useState("");
  const [listId, setListId] = useState("");
  const [activeCode, setActiveCode] = useState("");
  const leavingByTab = useRef(false);
  const selected = items.find(item => item.code === value);
  const options = filterAddressOptions(items, query);
  return <div className="field min-w-0 content-start">
    <label htmlFor={name} className="field-label w-fit cursor-pointer">{label}</label>
    <input type="hidden" name={name} value={value} />
    <Popover open={open && !disabled} onOpenChange={next => { setOpen(next); if (next) { setQuery(""); setActiveCode(filterAddressOptions(items, "")[0]?.code || ""); } }}>
      <PopoverTrigger asChild>
        <button id={name} type="button" role="combobox" aria-label={label} aria-expanded={open && !disabled} aria-controls={open && !disabled ? listId || undefined : undefined} aria-haspopup="listbox"
          aria-invalid={Boolean(error)} aria-required="true" aria-describedby={error || hint ? `${name}-help` : undefined} disabled={disabled}
          onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setQuery(""); setActiveCode(filterAddressOptions(items, "")[0]?.code || ""); setOpen(true); } }}
          className="field-control flex items-center justify-between gap-2 text-left disabled:cursor-not-allowed disabled:opacity-60">
          <span className="min-w-0 truncate" title={selected?.name}>{loading ? "Đang tải địa chỉ…" : selected?.name || `Chọn ${label.toLowerCase()}`}</span><ChevronDown className="size-4 shrink-0" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent onCloseAutoFocus={event => { if (leavingByTab.current) { event.preventDefault(); leavingByTab.current = false; } }}>
        <Command shouldFilter={false} value={activeCode} onValueChange={setActiveCode} label={`Tìm ${label.toLowerCase()}`}>
          <CommandInput asChild aria-label={`Tìm ${label.toLowerCase()}`} placeholder="Gõ tên để lọc" value={query} onValueChange={next => { setQuery(next); setActiveCode(filterAddressOptions(items, next)[0]?.code || ""); }}
            onKeyDown={event => {
              if (event.key === "Tab") {
                event.preventDefault(); leavingByTab.current = true; setOpen(false);
                // Portal list is outside the form: Tab exits relative to the original field.
                const trigger = document.getElementById(name); const form = trigger?.closest("form");
                const controls = form ? [...form.querySelectorAll<HTMLElement>('input:not([type="hidden"]),select,textarea,button,a[href]')]
                  .filter(control => !control.matches(":disabled") && control.getClientRects().length > 0 && control.tabIndex >= 0) : [];
                const index = controls.indexOf(trigger!); const target = controls[index + (event.shiftKey ? -1 : 1)];
                requestAnimationFrame(() => target?.focus());
              }
            }}>
            {/* Explicit IDs keep the active descendant valid when filtered options change. */}
            <input aria-activedescendant={options.some(item => item.code === activeCode) ? `${name}-option-${activeCode}` : undefined} />
          </CommandInput>
          <CommandList ref={node => { if (node) setListId(node.id); }} label={`Gợi ý ${label.toLowerCase()}`}>
            <CommandEmpty className="p-4 text-center text-sm text-gray-600">Không có kết quả. Thử gõ ngắn hơn.</CommandEmpty>
            {options.map(item => <CommandItem asChild key={item.code} value={item.code} onSelect={() => { onChange(item.code); setOpen(false); }}>
              <div id={`${name}-option-${item.code}`}><span className="min-w-0 flex-1 break-words">{item.name}</span><Check className={`size-4 shrink-0 ${value === item.code ? "opacity-100" : "opacity-0"}`} aria-hidden="true" /></div>
            </CommandItem>)}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
    {error || hint ? <p id={`${name}-help`} className={error ? "field-error" : "text-sm text-gray-600"}>{error || hint}</p> : null}
  </div>;
}
