import { beforeEach, describe, expect, it } from "vitest";
import { setupGlobalCleanup } from "../memory-leak-prevention";

describe("setupGlobalCleanup", () => {
  beforeEach(() => localStorage.clear());

  it("keeps theme and performance config on unload", () => {
    localStorage.setItem("theme", "dark");
    localStorage.setItem("csv-diff-performance-config", "{}");
    localStorage.setItem("perfDashboardActive", "true");
    localStorage.setItem("csv-diff-tmp:abc", "x");
    sessionStorage.setItem("s", "1");

    const dispose = setupGlobalCleanup();
    window.dispatchEvent(new Event("pagehide"));

    expect(localStorage.getItem("theme")).toBe("dark");
    expect(localStorage.getItem("csv-diff-performance-config")).toBe("{}");
    expect(localStorage.getItem("perfDashboardActive")).toBe("true");
    expect(localStorage.getItem("csv-diff-tmp:abc")).toBeNull();
    expect(sessionStorage.getItem("s")).toBeNull();
    dispose();
  });
});
