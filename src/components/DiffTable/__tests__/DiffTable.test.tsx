import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, vi } from "vitest";
import { DiffTable } from "../../DiffTable";

const results = {
  source: { headers: ["name", "city"] },
  target: { headers: ["name", "city"] },
  added: [{ key: "3", targetRow: { name: "carol", city: "paris" } }],
  removed: [{ key: "4", sourceRow: { name: "dave", city: "rome" } }],
  modified: [
    {
      key: "2",
      sourceRow: { name: "bob", city: "oslo" },
      targetRow: { name: "bob", city: "bern" },
      differences: [],
    },
  ],
  unchanged: [{ key: "1", row: { name: "alice", city: "berlin" } }],
};

function bodyRows() {
  return screen
    .getAllByRole("row")
    .filter((tr) => within(tr).queryAllByRole("columnheader").length === 0);
}

function nameOrder() {
  return bodyRows().map((tr) => within(tr).getAllByRole("cell")[1].textContent);
}

describe("DiffTable", () => {
  beforeAll(() => {
    // jsdom has no layout; give the virtualizer a viewport so rows render
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      right: 800,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
      configurable: true,
      value: 600,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
      configurable: true,
      value: 800,
    });
  });

  afterEach(() => localStorage.clear());

  it("renders one table row per diff row with type badges and counts", () => {
    render(<DiffTable results={results} showOnlyDiffs={false} />);

    expect(bodyRows()).toHaveLength(4);
    expect(screen.getByText("Added (1)")).toBeTruthy();
    expect(screen.getByText("Removed (1)")).toBeTruthy();
    expect(screen.getByText("Modified (1)")).toBeTruthy();
    expect(screen.getByText("4 rows found")).toBeTruthy();
  });

  it("hides unchanged rows when showOnlyDiffs is set", () => {
    render(<DiffTable results={results} showOnlyDiffs />);
    expect(bodyRows()).toHaveLength(3);
    expect(screen.queryByText("alice")).toBeNull();
  });

  it("toggles sorting via the header button and exposes aria-sort", () => {
    render(<DiffTable results={results} showOnlyDiffs={false} />);

    const nameHeader = screen.getByRole("columnheader", { name: /name/ });
    const button = within(nameHeader).getByRole("button");
    expect(nameHeader.getAttribute("aria-sort")).toBeNull();

    fireEvent.click(button);
    expect(nameHeader.getAttribute("aria-sort")).toBe("ascending");
    expect(nameOrder()).toEqual(["alice", "bob", "carol", "dave"]);

    fireEvent.click(button);
    expect(nameHeader.getAttribute("aria-sort")).toBe("descending");
    expect(nameOrder()).toEqual(["dave", "carol", "bob", "alice"]);
  });

  it("global filter reduces rows while counts stay unfiltered", () => {
    render(<DiffTable results={results} showOnlyDiffs={false} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "carol" },
    });

    expect(nameOrder()).toEqual(["carol"]);
    expect(screen.getByText("1 rows found")).toBeTruthy();
    expect(screen.getByText("Added (1)")).toBeTruthy();
    expect(screen.getByText("Removed (1)")).toBeTruthy();
    expect(screen.getByText("Modified (1)")).toBeTruthy();
  });

  it("restores column visibility from localStorage", () => {
    localStorage.setItem(
      "csv-diff-viewer-column-visibility",
      JSON.stringify({ city_1: false }),
    );
    render(<DiffTable results={results} showOnlyDiffs={false} />);

    expect(screen.queryByRole("columnheader", { name: /city/ })).toBeNull();
    expect(screen.getByRole("columnheader", { name: /name/ })).toBeTruthy();
  });
});
