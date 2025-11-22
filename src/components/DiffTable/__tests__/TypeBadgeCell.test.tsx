import React from "react";
import { render, screen } from "@testing-library/react";
import { TypeBadgeCell } from "../CellRenderers";
import type { CellContext } from "@tanstack/react-table";

function makeProps(value: string) {
  // A minimal fake CellContext shape that the component accesses.
  const ctx: Partial<CellContext<any, any>> = {
    getValue: () => value,
  };
  return ctx as any;
}

describe("TypeBadgeCell", () => {
  it("renders added badge", () => {
    render(<TypeBadgeCell {...makeProps("added")} />);
    expect(screen.getByText("added")).toBeTruthy();
  });

  it("renders removed badge", () => {
    render(<TypeBadgeCell {...makeProps("removed")} />);
    expect(screen.getByText("removed")).toBeTruthy();
  });

  it("renders modified badge", () => {
    render(<TypeBadgeCell {...makeProps("modified")} />);
    expect(screen.getByText("modified")).toBeTruthy();
  });

  it("renders unchanged badge", () => {
    render(<TypeBadgeCell {...makeProps("unchanged")} />);
    expect(screen.getByText("unchanged")).toBeTruthy();
  });
});
