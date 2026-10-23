// Each page calls requireUser itself, so sign-in returns people to the page they asked for.
export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
