import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import HeaderControls from "../HeaderControls";
import type { Column } from "@tanstack/react-table";

describe("HeaderControls", () => {
  function makeMockColumn(id: string) {
    return {
      id,
      getCanHide: () => true,
      getIsVisible: () => true,
      toggleVisibility: () => {},
      getCanFilter: () => true,
      getFilterValue: () => undefined,
    } as unknown as Column<any>;
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
    expect(setActiveFilter).toHaveBeenCalled();
  });
});
