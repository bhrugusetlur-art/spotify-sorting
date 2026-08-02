import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mood Sorter",
  description: "Sort Spotify liked songs into stable mood playlists.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
