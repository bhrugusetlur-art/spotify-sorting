import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandingPage } from "./landing-page";

describe("LandingPage", () => {
  it("explains the product and links to Spotify login", () => {
    render(<LandingPage />);

    expect(screen.getByRole("heading", { name: /sort your liked songs by mood/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /connect spotify/i })).toHaveAttribute("href", "/api/auth/spotify/start");
  });

  it("shows a safe message when Spotify login fails", () => {
    render(<LandingPage errorCode="SPOTIFY_PERMISSION_DENIED" />);

    expect(screen.getByRole("alert")).toHaveTextContent(/permission was not granted/i);
  });
});
