import { NextRequest } from 'next/server'
import { auth } from '@/auth'

export async function POST(req: NextRequest) {
  const session = await auth()
  if (!session) return new Response('Unauthorized', { status: 401 })

  await req.json()

  return new Response(
    JSON.stringify({ message: 'Live recon is used during TC generation — no separate explore step needed.' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  )
}
