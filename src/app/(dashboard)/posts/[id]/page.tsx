import { redirect } from 'next/navigation';

/**
 * There is no standalone post-detail page — the post editor / producer lives in
 * the AI Studio. Several places (calendar, strategy items) link to /posts/[id],
 * which previously 404'd. Redirect them to the studio with the post preloaded.
 */
export default async function PostRedirectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/ai-studio?postId=${id}`);
}
