import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "./App.js";

describe("App", () => {
  it("renders the navigation", () => {
    render(<App />);
    expect(screen.getByText("项目")).toBeTruthy();
  });
});
