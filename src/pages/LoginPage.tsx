import type * as React from 'react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, Input } from '@/components/shared'
import { BrandMark } from '@/components/layout/BrandMark'
import { useAuth } from '@/lib/auth/context'

export function LoginPage() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    const result = await signIn(email, password)
    setSubmitting(false)
    setError(result.error)
  }

  return (
    <div className="flex min-h-svh items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <BrandMark className="justify-center" />
        <Card title="Sign in" description="Use your MPS Mortgage LOSuite account.">
          <form onSubmit={onSubmit} className="space-y-4">
            <Input label="Email" type="email" autoComplete="email" value={email} onChange={setEmail} required />
            <Input
              label="Password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={setPassword}
              required
              error={error ?? undefined}
            />
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        </Card>
        <p className="text-center text-xs text-muted-foreground">MPS Mortgage LLC · NMLS #2501110</p>
      </div>
    </div>
  )
}
