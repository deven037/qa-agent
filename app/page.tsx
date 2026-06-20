import { redirect } from 'next/navigation'
import { auth } from '@/auth'
import { isConfigured } from '@/lib/config/store'

export default async function RootPage() {
  const session = await auth()
  if (!session) redirect('/login')
  if (!(await isConfigured())) redirect('/setup')
  redirect('/dashboard')
}
