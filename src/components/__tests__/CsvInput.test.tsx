import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CsvInput } from "../CsvInput";

describe("CsvInput debounce", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const setup = () => {
    const onDataChange = vi.fn();
    render(<CsvInput title="Source" onDataChange={onDataChange} />);
    const area = screen.getByPlaceholderText("Paste CSV content here...");
    return { onDataChange, area };
  };

  it("flushes the latest text synchronously on blur", () => {
    const { onDataChange, area } = setup();
    fireEvent.change(area, { target: { value: "a,b" } });
    expect(onDataChange).not.toHaveBeenCalled();
    fireEvent.blur(area);
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledWith("a,b", "Manual Input");
  });

  it("emits once after the debounce window", () => {
    const { onDataChange, area } = setup();
    fireEvent.change(area, { target: { value: "x" } });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(onDataChange).toHaveBeenCalledTimes(1);
    expect(onDataChange).toHaveBeenCalledWith("x", "Manual Input");
  });

  it("does not emit twice after a flush", () => {
    const { onDataChange, area } = setup();
    fireEvent.change(area, { target: { value: "y" } });
    fireEvent.blur(area);
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(onDataChange).toHaveBeenCalledTimes(1);
  });
});
