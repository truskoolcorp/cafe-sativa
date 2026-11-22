import Link from 'next/link'
import { PasswordRecoveryRequest } from './request'
export default function PasswordRecoveryPage() {
  return <main className="max-w-md mx-auto px-4 py-24"><h1 className="font-heading text-3xl font-bold">Reset your password</h1><p className="text-muted-foreground mt-3">Enter your account email to request a recovery link.</p><PasswordRecoveryRequest/><Link href="/auth/signin" className="text-primary underline inline-block mt-8">Return to sign in</Link></main>
}
