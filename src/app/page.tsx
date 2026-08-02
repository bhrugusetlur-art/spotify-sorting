import { LandingPage } from "@/components/landing-page";

export default async function HomePage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;

  return <LandingPage errorCode={error} />;
}
