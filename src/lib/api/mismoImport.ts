import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { BorrowerTarget } from '@/lib/mismo/importPlan'
import { personChanges, sameAddress } from '@/lib/mismo/importPlan'
import type { ImportedLien, ImportedProperty, ImportResult } from '@/lib/mismo/parse'
import { db, keys, unwrap } from './client'
import { saveLoanDetails } from './loans'
import { phoneDigits } from '@/lib/pipeline/helpers'
import type { Lien, LoanProfile, Property } from './types'
import { toSnake, type ApplicationBorrower } from './urla'

// Applies a parsed MISMO file to a loan. Lists (addresses, jobs, other
// income, assets, liabilities, a property's liens) are replaced rather than
// merged, so importing the same file again gives the same result.

export interface ImportSummary {
  borrowersUpdated: number
  borrowersAdded: number
  assets: number
  liabilities: number
  properties: number
}

/** camelCase values -> snake_case row, dropping undefined. */
const row = (values: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(values).filter(([, v]) => v !== undefined).map(([k, v]) => [toSnake(k), v]))

const check = (result: { error: { message: string } | null }, what: string) => {
  if (result.error) throw new Error(`${what}: ${result.error.message}`)
}

/**
 * Replaces a property's liens with the file's. MISMO doesn't carry a lien's
 * rate, closing date or Texas cash-out flag, so those are kept from the
 * existing lien in the same position.
 */
async function replaceLiens(organizationId: string, propertyId: string, liens: ImportedLien[], existing: Lien[] = []) {
  check(await db().from('property_liens').delete().eq('property_id', propertyId), 'Removing old mortgages')
  if (liens.length === 0) return
  check(
    await db().from('property_liens').insert(
      liens.map((l) => {
        const kept = existing.find((e) => e.position === l.position)
        return {
          organization_id: organizationId,
          property_id: propertyId,
          position: l.position,
          lender: l.lender ?? kept?.lender ?? null,
          balance: l.balance ?? kept?.balance ?? null,
          monthly_payment: l.monthlyPayment ?? kept?.monthlyPayment ?? null,
          is_heloc: l.isHeloc,
          credit_limit: l.creditLimit ?? kept?.creditLimit ?? null,
          to_be_paid_off: l.toBePaidOff,
          mortgage_type: l.mortgageType ?? kept?.mortgageType ?? null,
          note_rate: kept?.noteRate ?? null,
          originated_on: kept?.originatedOn ?? null,
          is_texas_cash_out: kept?.isTexasCashOut ?? false,
        }
      }),
    ),
    'Saving mortgages',
  )
}

/** Property fields from the file; values the file doesn't have are left alone. */
function propertyFields(p: ImportedProperty, creating: boolean) {
  const fields: Record<string, unknown> = {
    address_line: p.addressLine || undefined,
    city: p.city ?? undefined,
    state: p.state ?? undefined,
    zip: p.zip ?? undefined,
    county: p.county ?? undefined,
    estimated_value: p.estimatedValue ?? undefined,
    unit_count: p.unitCount ?? undefined,
    reo_disposition: p.reoDisposition ?? undefined,
    reo_occupancy: p.reoOccupancy ?? undefined,
    monthly_rent: p.monthlyRent ?? undefined,
  }
  // ULAD sends taxes, insurance and HOA as one monthly figure; on a new property it goes into annual taxes.
  if (creating && p.monthlyMaintenance) fields.annual_taxes = Math.round(p.monthlyMaintenance * 12 * 100) / 100
  return Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
}

export function useApplyImport(loan: LoanProfile) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      result,
      targets,
      existingBorrowers,
      existingProperties,
    }: {
      result: ImportResult
      targets: BorrowerTarget[]
      existingBorrowers: ApplicationBorrower[]
      existingProperties: Property[]
    }): Promise<ImportSummary> => {
      const org = loan.organizationId
      const summary: ImportSummary = { borrowersUpdated: 0, borrowersAdded: 0, assets: 0, liabilities: 0, properties: 0 }

      // 1. Resolve each file borrower to a contact on this loan.
      const contactIds: (string | null)[] = []
      for (const [i, b] of result.borrowers.entries()) {
        const target = targets[i]
        if (target.kind === 'skip') {
          contactIds.push(null)
        } else if (target.kind === 'update') {
          contactIds.push(target.contactId)
          summary.borrowersUpdated++
        } else {
          const id = unwrap<string>(
            await db().rpc('add_borrower', {
              p_loan_id: loan.id,
              p_first_name: b.person.firstName || 'Borrower',
              p_last_name: b.person.lastName,
              p_email: b.person.email ?? '',
              p_phone: b.person.phone ?? '',
              p_existing_contact_id: null,
            }),
          )
          contactIds.push(id)
          summary.borrowersAdded++
        }
      }
      const primaryContact =
        contactIds.find((id) => id !== null) ?? existingBorrowers.find((b) => b.role === 'primary')?.contactId ?? null
      if (!primaryContact) throw new Error('No borrower to import into.')

      // 2. Person facts, addresses, jobs, other income, declarations.
      for (const [i, b] of result.borrowers.entries()) {
        const contactId = contactIds[i]
        if (!contactId) continue
        const person = personChanges(b.person)
        // Same number written differently ("214-555-0199" vs "2145550199"): keep how it's already written.
        const current = existingBorrowers.find((e) => e.contactId === contactId)?.person
        for (const key of ['phone', 'homePhone', 'workPhone'] as const) {
          if (current && person[key] && phoneDigits(person[key]) === phoneDigits(current[key])) delete person[key]
        }
        if (Object.keys(person).length) check(await db().from('contacts').update(row(person)).eq('id', contactId), 'Saving borrower')

        for (const [table, items] of [
          ['contact_addresses', b.addresses],
          ['employments', b.employments],
          ['other_incomes', b.otherIncomes],
        ] as const) {
          check(await db().from(table).delete().eq('contact_id', contactId), `Clearing ${table}`)
          if (items.length) {
            check(
              await db().from(table).insert(items.map((item) => ({ ...row(item as unknown as Record<string, unknown>), contact_id: contactId, organization_id: org }))),
              `Saving ${table}`,
            )
          }
        }

        const d = b.declarations
        const hasDeclarations = Object.values(d).some((v) => (Array.isArray(v) ? v.length > 0 : v !== null && v !== false))
        if (hasDeclarations) {
          check(
            await db().from('borrower_declarations').upsert({ ...row(d as unknown as Record<string, unknown>), loan_id: loan.id, contact_id: contactId }, { onConflict: 'loan_id,contact_id' }),
            'Saving declarations',
          )
        }
      }

      // 3. Assets and liabilities for the loan: replace.
      const ownerFields = (owners: number[]) => {
        const ids = owners.map((o) => contactIds[o]).filter((id): id is string => !!id)
        return { contact_id: ids[0] ?? primaryContact, is_joint: ids.length > 1 }
      }
      check(await db().from('assets').delete().eq('loan_id', loan.id), 'Clearing assets')
      if (result.assets.length) {
        check(
          await db().from('assets').insert(result.assets.map(({ owners, ...a }) => ({ ...row(a), ...ownerFields(owners), loan_id: loan.id }))),
          'Saving assets',
        )
      }
      check(await db().from('liabilities').delete().eq('loan_id', loan.id), 'Clearing liabilities')
      if (result.liabilities.length) {
        check(
          await db().from('liabilities').insert(result.liabilities.map(({ owners, ...l }) => ({ ...row(l), ...ownerFields(owners), loan_id: loan.id }))),
          'Saving liabilities',
        )
      }
      summary.assets = result.assets.length
      summary.liabilities = result.liabilities.length

      // 4. Loan details (the loan purpose is never changed by an import).
      await saveLoanDetails(loan.id, result.loan)

      // 5. Subject property and other real estate owned.
      const savedProperties = [...existingProperties]
      const upsertProperty = async (p: ImportedProperty, status: string, existingId: string | null) => {
        if (existingId) {
          const fields = propertyFields(p, false)
          if (Object.keys(fields).length) check(await db().from('properties').update(fields).eq('id', existingId), 'Saving property')
          if (p.liens.length) await replaceLiens(org, existingId, p.liens, savedProperties.find((s) => s.id === existingId)?.liens)
          return existingId
        }
        if (!p.addressLine) return null
        const created = unwrap<{ id: string }>(
          await db().from('properties').insert({ ...propertyFields(p, true), loan_id: loan.id, organization_id: org, status }).select('id').single(),
        )
        await replaceLiens(org, created.id, p.liens)
        return created.id
      }

      if (result.subject) {
        const isPurchase = loan.purpose === 'purchase' || (loan.purpose === 'investment_dscr' && (result.loan.purchasePrice ?? loan.details.purchasePrice) !== null)
        const existingId =
          loan.details.subjectPropertyId ?? savedProperties.find((p) => sameAddress(p, result.subject!))?.id ?? null
        const id = await upsertProperty(result.subject, isPurchase ? 'under_contract' : 'current_home', existingId)
        if (id && id !== loan.details.subjectPropertyId) await saveLoanDetails(loan.id, { subjectPropertyId: id })
        if (id) summary.properties++
      }
      for (const p of result.ownedProperties) {
        const match = savedProperties.find((s) => s.id !== loan.details.subjectPropertyId && sameAddress(s, p))
        const id = await upsertProperty(p, 'owned', match?.id ?? null)
        if (id) summary.properties++
      }

      return summary
    },
    onSettled: () => {
      for (const key of [keys.application(loan.id), keys.loan(loan.id), keys.properties(loan.id), keys.pipeline, keys.contacts]) {
        queryClient.invalidateQueries({ queryKey: key })
      }
    },
  })
}
