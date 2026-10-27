import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, keys, num, unwrap } from './client'
import { scenariosFollowHome } from './pricing'
import type { Lien, MortgageType, Occupancy, Property, PropertyStatus, PropertyType, RentalIncomeMethod, ReoDisposition } from './types'

interface LienRow {
  id: string
  property_id: string
  position: 'first' | 'second'
  lender: string | null
  balance: number | string | null
  note_rate: number | string | null
  monthly_payment: number | string | null
  is_heloc: boolean
  originated_on: string | null
  is_texas_cash_out: boolean
  to_be_paid_off: boolean
  credit_limit: number | string | null
  mortgage_type: MortgageType | null
}

interface PropertyRow {
  id: string
  loan_id: string
  address_line: string
  city: string | null
  state: string
  zip: string | null
  county: string | null
  property_type: PropertyType | null
  status: PropertyStatus
  list_price: number | string | null
  estimated_value: number | string | null
  annual_taxes: number | string | null
  annual_insurance: number | string | null
  monthly_hoa: number | string | null
  monthly_rent: number | string | null
  is_homestead: boolean
  listing_url: string | null
  unit_count: number | null
  reo_disposition: ReoDisposition | null
  reo_occupancy: Occupancy | null
  rental_income_method: RentalIncomeMethod
  schedule_e_monthly_income: number | string | null
  created_at: string
  liens: LienRow[]
}

const PROPERTY_SELECT = `
  id, loan_id, address_line, city, state, zip, county, property_type, status, list_price, estimated_value,
  annual_taxes, annual_insurance, monthly_hoa, monthly_rent, is_homestead, listing_url, unit_count, reo_disposition, reo_occupancy,
  rental_income_method, schedule_e_monthly_income, created_at,
  liens:property_liens ( id, property_id, position, lender, balance, note_rate, monthly_payment, is_heloc, originated_on, is_texas_cash_out, to_be_paid_off, credit_limit, mortgage_type )
`

function toLien(r: LienRow): Lien {
  return {
    id: r.id,
    propertyId: r.property_id,
    position: r.position,
    lender: r.lender,
    balance: num(r.balance),
    noteRate: num(r.note_rate),
    monthlyPayment: num(r.monthly_payment),
    isHeloc: r.is_heloc,
    originatedOn: r.originated_on,
    isTexasCashOut: r.is_texas_cash_out,
    toBePaidOff: r.to_be_paid_off,
    creditLimit: num(r.credit_limit),
    mortgageType: r.mortgage_type,
  }
}

function toProperty(r: PropertyRow): Property {
  return {
    id: r.id,
    loanId: r.loan_id,
    addressLine: r.address_line,
    city: r.city,
    state: r.state,
    zip: r.zip,
    county: r.county,
    propertyType: r.property_type,
    status: r.status,
    listPrice: num(r.list_price),
    estimatedValue: num(r.estimated_value),
    annualTaxes: num(r.annual_taxes),
    annualInsurance: num(r.annual_insurance),
    monthlyHoa: num(r.monthly_hoa),
    monthlyRent: num(r.monthly_rent),
    isHomestead: r.is_homestead,
    listingUrl: r.listing_url,
    unitCount: r.unit_count,
    reoDisposition: r.reo_disposition,
    reoOccupancy: r.reo_occupancy,
    rentalIncomeMethod: r.rental_income_method,
    scheduleEMonthlyIncome: num(r.schedule_e_monthly_income),
    createdAt: r.created_at,
    liens: r.liens.map(toLien).sort((a, b) => a.position.localeCompare(b.position)),
  }
}

/** Every property on a loan, with its existing liens. */
export function useProperties(loanId: string) {
  return useQuery({
    queryKey: keys.properties(loanId),
    queryFn: async () => {
      const rows = unwrap<PropertyRow[]>(
        await db().from('properties').select(PROPERTY_SELECT).eq('loan_id', loanId).order('created_at'),
      )
      return rows.map(toProperty)
    },
  })
}

// Rental method and Schedule E income are set from the Income tab, not the property form.
export type PropertyInput = Omit<Property, 'id' | 'loanId' | 'createdAt' | 'liens' | 'rentalIncomeMethod' | 'scheduleEMonthlyIncome'>

function propertyRow(p: PropertyInput) {
  return {
    address_line: p.addressLine.trim(),
    city: p.city?.trim() || null,
    state: p.state.trim().toUpperCase(),
    zip: p.zip?.trim() || null,
    county: p.county?.trim() || null,
    property_type: p.propertyType,
    status: p.status,
    list_price: p.listPrice,
    estimated_value: p.estimatedValue,
    annual_taxes: p.annualTaxes,
    annual_insurance: p.annualInsurance,
    monthly_hoa: p.monthlyHoa,
    monthly_rent: p.monthlyRent,
    is_homestead: p.isHomestead,
    listing_url: p.listingUrl?.trim() || null,
    unit_count: p.unitCount,
    reo_disposition: p.reoDisposition,
    reo_occupancy: p.reoOccupancy,
  }
}

/** Refresh everything that shows property-derived numbers (Overview reads them too). */
function useInvalidateLoanProperties(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: keys.properties(loanId) })
    queryClient.invalidateQueries({ queryKey: keys.loan(loanId) })
    queryClient.invalidateQueries({ queryKey: keys.pricingScenarios(loanId) })
  }
}

/** Adds a property (no id) or updates one (with id). Returns the property id. */
export function useSaveProperty(loanId: string, organizationId: string) {
  const invalidate = useInvalidateLoanProperties(loanId)
  return useMutation({
    mutationFn: async ({ id, ...input }: PropertyInput & { id?: string }) => {
      if (id) {
        const old = unwrap<{ annual_taxes: unknown; annual_insurance: unknown; monthly_hoa: unknown } | null>(await db().from('properties').select('annual_taxes, annual_insurance, monthly_hoa').eq('id', id).maybeSingle())
        const rows = unwrap<{ id: string }[]>(await db().from('properties').update(propertyRow(input)).eq('id', id).select('id'))
        if (rows.length === 0) throw new Error('You do not have permission to edit this property.')
        // Pricing scenarios for this home pick up its new taxes, insurance and HOA.
        if (old) await scenariosFollowHome(id, { annualTaxes: num(old.annual_taxes), annualInsurance: num(old.annual_insurance), monthlyHoa: num(old.monthly_hoa) }, { annualTaxes: input.annualTaxes, annualInsurance: input.annualInsurance, monthlyHoa: input.monthlyHoa })
        return id
      }
      const row = unwrap<{ id: string }>(
        await db()
          .from('properties')
          .insert({ ...propertyRow(input), loan_id: loanId, organization_id: organizationId })
          .select('id')
          .single(),
      )
      return row.id
    },
    onSuccess: invalidate,
  })
}

export function useDeleteProperty(loanId: string) {
  const invalidate = useInvalidateLoanProperties(loanId)
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await db().from('properties').delete().eq('id', id))
    },
    onSuccess: invalidate,
  })
}

export type LienInput = Omit<Lien, 'id' | 'propertyId'>

/** Adds a lien (no id) or updates one (with id). */
export function useSaveLien(loanId: string, organizationId: string) {
  const invalidate = useInvalidateLoanProperties(loanId)
  return useMutation({
    mutationFn: async ({ id, propertyId, ...l }: LienInput & { id?: string; propertyId: string }) => {
      const row = {
        position: l.position,
        lender: l.lender?.trim() || null,
        balance: l.balance,
        note_rate: l.noteRate,
        monthly_payment: l.monthlyPayment,
        is_heloc: l.isHeloc,
        originated_on: l.originatedOn || null,
        is_texas_cash_out: l.isTexasCashOut,
        to_be_paid_off: l.toBePaidOff,
        credit_limit: l.creditLimit,
        mortgage_type: l.mortgageType,
      }
      if (id) {
        unwrap(await db().from('property_liens').update(row).eq('id', id).select('id'))
      } else {
        unwrap(await db().from('property_liens').insert({ ...row, property_id: propertyId, organization_id: organizationId }).select('id'))
      }
    },
    onSuccess: invalidate,
  })
}

export function useDeleteLien(loanId: string) {
  const invalidate = useInvalidateLoanProperties(loanId)
  return useMutation({
    mutationFn: async (id: string) => {
      unwrap(await db().from('property_liens').delete().eq('id', id))
    },
    onSuccess: invalidate,
  })
}
