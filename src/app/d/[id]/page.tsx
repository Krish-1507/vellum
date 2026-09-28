import { Workspace } from "@/components/Workspace";

export const dynamic = "force-dynamic";

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <Workspace documentId={id} />;
}
