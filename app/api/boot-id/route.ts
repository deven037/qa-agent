import { BOOT_ID } from '@/lib/boot-id'

export async function GET() {
  return new Response(BOOT_ID, {
    headers: { 'Cache-Control': 'no-store' },
  })
}
