import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Dashboard } from "./dashboard";

describe("Dashboard", () => {
  it("shows the linked account and five mood destinations", () => {
    render(<Dashboard account={{ displayName: "Ada", imageUrl: null }} />);

    expect(screen.getByText(/connected as ada/i)).toBeInTheDocument();
    for (const mood of ["Chill", "Hype", "Focus", "Sad", "Happy"]) {
      expect(screen.getByText(mood)).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: /sort my music/i })).toBeDisabled();
  });
});
