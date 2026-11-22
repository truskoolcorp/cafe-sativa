import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { loungeUsernamesEnabled, readLoungeUsername } from '@/lib/lounge-usernames'
import { UsernameForm } from './username-form'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Chat username · Café Sativa', robots: { index: false, follow: false } }

export default async function ChatUsernamePage() {
  if (!loungeUsernamesEnabled) notFound()
  const client = createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user || user.is_anonymous) redirect('/auth/signin?next=%2Faccount%2Fchat-username')
  const username = await readLoungeUsername(client, user.id)
  return <main className="mx-auto min-h-screen max-w-2xl space-y-5 px-4 pb-16 pt-28">
    <Link href="/account" className="text-primary underline">Back to your account</Link>
    <h1 className="font-heading text-4xl font-bold">Chat username</h1>
    <p>Your username is visible in Café Sativa chats. It is separate from your email and sign-in.</p>
    <UsernameForm initialUsername={username} />
  </main>
}
