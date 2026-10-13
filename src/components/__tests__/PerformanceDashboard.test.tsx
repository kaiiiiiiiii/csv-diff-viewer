import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PerformanceDashboard } from "../PerformanceDashboard";

describe("PerformanceDashboard", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  function toggle() {
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "P",
          ctrlKey: true,
          shiftKey: true,
        }),
      );
    });
  }

  it("toggles visible false -> true -> false without hook-order errors", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<PerformanceDashboard />);
    expect(screen.queryByText("Performance Dashboard")).toBeNull();

    expect(() => toggle()).not.toThrow();
    expect(screen.getByText("Performance Dashboard")).toBeTruthy();

    expect(() => toggle()).not.toThrow();
    expect(screen.queryByText("Performance Dashboard")).toBeNull();

    const hookErrors = errorSpy.mock.calls.filter((c: Array<unknown>) =>
      String(c[0]).includes("hooks"),
    );
    expect(hookErrors).toHaveLength(0);
    errorSpy.mockRestore();
  });
});
