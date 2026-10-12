"use client";

import { useCallback, useEffect } from "react";
import { create } from "zustand";

type FloatingPanel = "chat" | "notifications";

// Presentation only: closing an old panel must not close its replacement.
export const useFloatingPanelStore = create<{
  active: FloatingPanel | null;
  setOpen: (panel: FloatingPanel, open: boolean) => void;
}>((set) => ({
  active: null,
  setOpen: (panel, open) => set((state) => ({
    active: open ? panel : state.active === panel ? null : state.active,
  })),
}));

export function useFloatingPanel(panel: FloatingPanel) {
  const open = useFloatingPanelStore((state) => state.active === panel);
  const setOpen = useCallback((value: boolean) => useFloatingPanelStore.getState().setOpen(panel, value), [panel]);
  useEffect(() => () => setOpen(false), [setOpen]);
  return { open, setOpen };
}

export function anotherFloatingPanelIsOpen(panel: FloatingPanel) {
  const active = useFloatingPanelStore.getState().active;
  return active !== null && active !== panel;
}

export function closeFloatingPanels() {
  useFloatingPanelStore.setState({ active: null });
}
