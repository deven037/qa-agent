import { redirect } from 'next/navigation'

export default async function AppPage({ params }: { params: Promise<{ appId: string }> }) {
  const { appId } = await params
  redirect(`/apps/${appId}/dashboard`)
}
