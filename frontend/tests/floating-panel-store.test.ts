import { beforeEach, describe, expect, it } from "vitest";
import { anotherFloatingPanelIsOpen, closeFloatingPanels, useFloatingPanelStore } from "../src/stores/floating-panel-store";

describe("floating chat/notification presentation", () => {
  beforeEach(closeFloatingPanels);
  it("opening either panel replaces the other", () => {
    const { setOpen } = useFloatingPanelStore.getState();
    setOpen("chat", true);
    expect(useFloatingPanelStore.getState().active).toBe("chat");
    setOpen("notifications", true);
    expect(useFloatingPanelStore.getState().active).toBe("notifications");
    setOpen("chat", true);
    expect(useFloatingPanelStore.getState().active).toBe("chat");
  });
  it("late close/cleanup of an old panel cannot close its replacement", () => {
    const { setOpen } = useFloatingPanelStore.getState();
    setOpen("chat", true);
    setOpen("notifications", true);
    setOpen("chat", false);
    expect(useFloatingPanelStore.getState().active).toBe("notifications");
    setOpen("notifications", false);
    expect(useFloatingPanelStore.getState().active).toBeNull();
  });
  it("focus handoff does not steal focus from the new panel", () => {
    useFloatingPanelStore.getState().setOpen("notifications", true);
    expect(anotherFloatingPanelIsOpen("chat")).toBe(true);
    expect(anotherFloatingPanelIsOpen("notifications")).toBe(false);
    closeFloatingPanels();
    expect(anotherFloatingPanelIsOpen("chat")).toBe(false);
  });
  it("mobile notification navigation clears the floating panel", () => {
    useFloatingPanelStore.getState().setOpen("chat", true);
    closeFloatingPanels();
    expect(useFloatingPanelStore.getState().active).toBeNull();
  });
});
