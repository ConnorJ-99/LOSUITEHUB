// /apply: the borrower application anyone can open (Stage 5). No sign-in and
// no shell, like the other public pages. `?lo=<email>` assigns the new lead
// to that loan officer (unknown = the company owner). Submitting makes a new
// lead, or matches an existing person (open file: a note and a task).
import { useEffect } from 'react'
import { useSearchParams } from 'react-router'
import logo from '@/assets/mps-logo.png'
import { isSupabaseConfigured } from '@/lib/supabase'
import { ApplicationWizard } from './ApplicationWizard'

export function PublicApplyPage() {
  const [params] = useSearchParams()
  useEffect(() => {
    document.title = 'Mortgage application · MPS Mortgage'
  }, [])
  return (
    <div className="min-h-screen bg-[#F4F7FB] text-foreground">
      <header className="bg-navy px-4 py-3">
        <div className="mx-auto flex max-w-xl items-center gap-2.5">
          <img src={logo} alt="" className="size-8 rounded-md bg-white object-contain p-0.5" />
          <span className="text-[15px] font-bold text-white">MPS Mortgage</span>
        </div>
      </header>
      <main className="mx-auto max-w-xl px-4 py-6">
        {isSupabaseConfigured ? <ApplicationWizard mode={{ kind: 'standalone', lo: params.get('lo') }} /> : <p className="text-sm text-muted-foreground">This page is not available.</p>}
        <p className="mt-6 text-center text-[11px] text-muted-foreground">MPS Mortgage LLC · NMLS #2501110 · Equal Housing Opportunity</p>
      </main>
    </div>
  )
}
