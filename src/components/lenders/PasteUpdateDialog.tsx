import { useState } from 'react'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DateInput, FormGrid, Input, Select, TextArea } from '@/components/shared'
import { useAiStatus, invokeAssistant } from '@/lib/api/assistant'
import { useLenders } from '@/lib/api/lenders'
import { useCreateProductUpdate } from '@/lib/api/productUpdates'
import { useAuth } from '@/lib/auth/context'
import { todayIso } from '@/lib/dates'
import { guessLender } from '@/lib/products/productUpdate'

/**
 * "Paste a product update": the email is saved the moment Read is pressed, then
 * opens on its own screen. With the assistant on, it's read first (nothing in
 * the catalog changes until Connor confirms and approves).
 */
export function PasteUpdateDialog({ lenderId: fixedLender = null, onClose }: { lenderId?: string | null; onClose: () => void }) {
  const { state } = useAuth()
  const lenders = useLenders()
  const ai = useAiStatus()
  const create = useCreateProductUpdate()
  const navigate = useNavigate()
  const [text, setText] = useState('')
  const [subject, setSubject] = useState('')
  const [receivedOn, setReceivedOn] = useState<string | null>(todayIso())
  const [picked, setPicked] = useState<string | null>(fixedLender)
  const [reading, setReading] = useState(false)
  const list = (lenders.data ?? []).filter((l) => l.status !== 'inactive' || l.id === fixedLender)
  // The lender named in the email, until one is picked by hand.
  const guessed = picked ?? guessLender(`${subject}\n${text}`, list)
  const ready = ai.data?.ready === true
  const tooShort = text.trim().length < 20
  if (state.status !== 'signedIn' || !state.user.organizationId) return null
  const organizationId = state.user.organizationId

  const save = async () => {
    try {
      const id = await create.mutateAsync({ organizationId, lenderId: guessed, subject: subject.trim() || null, pastedText: text.trim(), receivedOn: receivedOn ?? todayIso() })
      if (ready && guessed) {
        setReading(true)
        await invokeAssistant({ task: 'product_update_read', updateId: id }, 'The assistant could not read this email.').catch((e: Error) => toast.error(`${e.message} You can read it again or pick the changes by hand on the next screen.`))
      }
      onClose()
      navigate(`/admin/lenders/updates/${id}`)
    } catch (e) {
      toast.error((e as Error).message)
    } finally {
      setReading(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !reading && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Paste a product update</DialogTitle>
          <DialogDescription>Copy the lender's email (the body is enough) and paste it here. You'll see each proposed change next to what's on file before anything changes.</DialogDescription>
        </DialogHeader>
        <FormGrid className="lg:grid-cols-4">
          <TextArea label="The email" value={text} onChange={setText} rows={12} span={4} required className="max-h-[50vh] min-h-56" placeholder="Paste the email text here" />
          <Input label="Subject (optional)" value={subject} onChange={setSubject} span={2} />
          <DateInput label="Received" value={receivedOn} onChange={setReceivedOn} />
          <Select label="Lender" value={guessed} options={list.map((l) => ({ value: l.id, label: l.name }))} onChange={setPicked} placeholder={lenders.isLoading ? 'Loading…' : 'Pick the lender'} hint={!picked && guessed ? 'Found in the email; change it if it’s wrong' : undefined} />
        </FormGrid>
        {!ready && ai.data && <p className="text-xs text-muted-foreground">The assistant isn't set up yet, so you'll pick the programs and type the changes yourself on the next screen.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={reading}>
            Cancel
          </Button>
          <Button onClick={save} disabled={tooShort || create.isPending || reading}>
            {reading ? 'Reading… (about a minute)' : create.isPending ? 'Saving…' : ready && guessed ? 'Save and read' : 'Save and review'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
