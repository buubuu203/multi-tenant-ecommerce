import { SignIn } from "@clerk/nextjs";

export default function SignInPage() {
  return (
    <div className="flex flex-1 items-center justify-center bg-surface-muted py-16">
      <SignIn />
    </div>
  );
}
