import { FriendsView } from "@/components/social/FriendsView";
export const metadata = { title: "Friends" };
export default async function Page({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const { search } = await searchParams;
  return <FriendsView initialSearch={search?.slice(0, 24)} />;
}
