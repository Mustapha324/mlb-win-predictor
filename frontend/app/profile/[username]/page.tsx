import { ProfileView } from "@/components/social/ProfileView";
export const metadata = { title: "Player Profile" };
export default async function Page({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  return <ProfileView username={username} />;
}
