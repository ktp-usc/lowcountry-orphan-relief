import { SignInRedirect } from "@/components/sign-in-redirect";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  return <SignInRedirect error={error} />;
}