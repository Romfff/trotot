import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { clearSessionCache } from "../src/lib/bootstrap-session";

it.each(["homestay-search", "homestay-detail", "homestay-calendar", "homestay-quote"])(
  "preserves an in-flight public %s across session cache cleanup",
  async (key) => {
    const cache = new QueryClient();
    let finish!: (data: string) => void;
    const aborted = vi.fn();
    const observer = new QueryObserver(cache, {
      queryKey: [key, "fixture"], meta: { public: true }, retry: false,
      queryFn: ({ signal }) => new Promise<string>((resolve, reject) => {
        finish = resolve;
        signal.addEventListener("abort", () => { aborted(); reject(new Error("aborted")); });
      }),
    });
    const unsubscribe = observer.subscribe(() => {});
    try {
      cache.setQueryData(["bookings", "old-session"], "old-private-data");
      cache.setQueryData(["auth", "me"], "old-user");
      cache.getMutationCache().build(cache, { mutationKey: ["hold", "old-session"] });
      clearSessionCache(cache);
      clearSessionCache(cache); // Identity change and logout events may both fire.
      expect(aborted).not.toHaveBeenCalled();
      expect(cache.getQueryData(["bookings", "old-session"])).toBeUndefined();
      expect(cache.getQueryData(["auth", "me"])).toBeUndefined();
      expect(cache.getMutationCache().getAll()).toHaveLength(0);
      finish("public-calendar-result");
      await vi.waitFor(() => expect(observer.getCurrentResult().status).toBe("success"));
      expect(cache.getQueryData([key, "fixture"])).toBe("public-calendar-result");
    } finally { unsubscribe(); cache.clear(); }
  },
);

it("treats unknown and unmarked queries as private, cancels their reads and drops late data", async () => {
  const cache = new QueryClient();
  let finish!: (data: string) => void;
  const aborted = vi.fn();
  const observer = new QueryObserver(cache, {
    queryKey: ["bookings", "old-session"], retry: false,
    queryFn: ({ signal }) => new Promise<string>((resolve, reject) => {
      finish = resolve;
      signal.addEventListener("abort", () => { aborted(); reject(new Error("aborted")); });
    }),
  });
  const unsubscribe = observer.subscribe(() => {});
  try {
    cache.setQueryData(["future-private-feature"], "private");
    cache.setQueryData(["homestay-calendar", "unmarked"], "private-by-default");
    clearSessionCache(cache);
    expect(aborted).toHaveBeenCalledOnce();
    finish("late-private-response");
    await Promise.resolve();
    expect(cache.getQueryCache().getAll()).toHaveLength(0);
  } finally { unsubscribe(); cache.clear(); }
});
