import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import HeaderControls from "../HeaderControls";
import type { DiffTableColumn } from "../tableFeatures";

describe("HeaderControls", () => {
  function makeMockColumn(id: string) {
    return {
      id,
      getCanHide: () => true,
      getIsVisible: () => true,
      toggleVisibility: () => {},
      getCanFilter: () => true,
      getFilterValue: () => undefined,
    } as unknown as DiffTableColumn;
  }

  it("renders counts and toggles filters", () => {
    const setActiveFilter = vi.fn();
    const setGlobalFilter = vi.fn();
    const setShowColumnFilters = vi.fn();
    const setIsExpanded = vi.fn();
    const setIsFullscreen = vi.fn();

    render(
      <HeaderControls
        globalFilter=""
        setGlobalFilter={setGlobalFilter}
        activeFilter="all"
        setActiveFilter={setActiveFilter}
        counts={{ added: 1, removed: 2, modified: 3, unchanged: 0 }}
        showColumnFilters={false}
        setShowColumnFilters={setShowColumnFilters}
        columns={[makeMockColumn("__diff_type__"), makeMockColumn("name_0")]}
        filteredRowsLength={6}
        isExpanded={false}
        setIsExpanded={setIsExpanded}
        isFullscreen={false}
        setIsFullscreen={setIsFullscreen}
      />,
    );

    expect(screen.getByText("Added (1)")).toBeTruthy();
    expect(screen.getByText("Removed (2)")).toBeTruthy();
    expect(screen.getByText("Modified (3)")).toBeTruthy();

    fireEvent.click(screen.getByText("Added (1)"));
    expect(setActiveFilter).toHaveBeenCalledWith("added");
  });

  it("renders filter badges as focusable buttons with aria-pressed", () => {
    const props = {
      globalFilter: "",
      setGlobalFilter: vi.fn(),
      setActiveFilter: vi.fn(),
      counts: { added: 1, removed: 0, modified: 3, unchanged: 0 },
      showColumnFilters: false,
      setShowColumnFilters: vi.fn(),
      columns: [makeMockColumn("name_0")],
      filteredRowsLength: 4,
      isExpanded: false,
      setIsExpanded: vi.fn(),
      isFullscreen: false,
      setIsFullscreen: vi.fn(),
    };
    render(<HeaderControls {...props} activeFilter="modified" />);

    const added = screen.getByRole("button", { name: "Added (1)" });
    added.focus();
    expect(document.activeElement).toBe(added);
    expect(added.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen
        .getByRole("button", { name: "Modified (3)" })
        .getAttribute("aria-pressed"),
    ).toBe("true");

    const removed = screen.getByRole<HTMLButtonElement>("button", {
      name: "Removed (0)",
    });
    expect(removed.disabled).toBe(true);
    fireEvent.click(removed);
    expect(props.setActiveFilter).not.toHaveBeenCalled();

    expect(
      screen.getByRole("button", { name: "Toggle column filters" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Toggle columns" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Enter Fullscreen" }),
    ).toBeTruthy();
  });
});
