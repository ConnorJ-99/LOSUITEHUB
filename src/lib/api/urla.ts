import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type {
  AddressKind,
  ApplicationMethod,
  AssetType,
  Citizenship,
  EmploymentStatus,
  GiftSource,
  HmdaEthnicity,
  HmdaRace,
  HmdaSex,
  HousingKind,
  LiabilityType,
  MaritalStatus,
  OtherIncomeType,
  PriorPropertyUsage,
  PriorTitleHeld,
} from '@/lib/urla/options'
import { db, keys, num, unwrap } from './client'

// ---------------------------------------------------------------------------
// Types. Field names mirror the database columns in camelCase.
// ---------------------------------------------------------------------------

/** Person facts from the contact (1003 sections 1a and 7). No SSN, by decision. */
export interface PersonDetails {
  firstName: string
  middleName: string | null
  lastName: string
  suffix: string | null
  email: string | null
  phone: string | null
  homePhone: string | null
  workPhone: string | null
  workPhoneExt: string | null
  dateOfBirth: string | null
  citizenship: Citizenship | null
  maritalStatus: MaritalStatus | null
  dependentsCount: number | null
  dependentsAges: string | null
  militaryService: boolean | null
  militaryActiveDuty: boolean
  militaryServiceExpiresOn: string | null
  militaryRetired: boolean
  militaryReserveOnly: boolean
  militarySurvivingSpouse: boolean
}

export interface Address {
  id: string
  contactId: string
  kind: AddressKind
  addressLine: string
  unit: string | null
  city: string | null
  state: string | null
  zip: string | null
  country: string
  housing: HousingKind | null
  monthlyRent: number | null
  monthsAtAddress: number | null
}

export interface Employment {
  id: string
  contactId: string
  status: EmploymentStatus
  sortOrder: number
  employerName: string
  employerPhone: string | null
  addressLine: string | null
  unit: string | null
  city: string | null
  state: string | null
  zip: string | null
  positionTitle: string | null
  startDate: string | null
  endDate: string | null
  monthsInLineOfWork: number | null
  employedByParty: boolean
  isSelfEmployed: boolean
  ownership25OrMore: boolean | null
  baseIncome: number | null
  overtimeIncome: number | null
  bonusIncome: number | null
  commissionIncome: number | null
  militaryEntitlements: number | null
  otherEmploymentIncome: number | null
  selfEmployedIncome: number | null
}

export interface OtherIncome {
  id: string
  contactId: string
  incomeType: OtherIncomeType
  description: string | null
  monthlyAmount: number
}

export interface Asset {
  id: string
  loanId: string
  contactId: string
  isJoint: boolean
  assetType: AssetType
  institutionName: string | null
  accountLast4: string | null
  amount: number
  giftSource: GiftSource | null
  giftDeposited: boolean | null
  description: string | null
}

export interface Liability {
  id: string
  loanId: string
  contactId: string
  isJoint: boolean
  liabilityType: LiabilityType
  creditorName: string | null
  accountLast4: string | null
  unpaidBalance: number | null
  monthlyPayment: number
  monthsRemaining: number | null
  toBePaidOff: boolean
  description: string | null
}

/** Section 5 declarations and section 8 demographics for one borrower on one loan. */
export interface Declarations {
  willOccupyAsPrimary: boolean | null
  ownedPropertyPast3Years: boolean | null
  priorPropertyUsage: PriorPropertyUsage | null
  priorTitleHeld: PriorTitleHeld | null
  familyRelationshipWithSeller: boolean | null
  borrowingUndisclosedMoney: boolean | null
  undisclosedMoneyAmount: number | null
  applyingOtherMortgage: boolean | null
  applyingNewCredit: boolean | null
  subjectToPriorityLien: boolean | null
  cosignerOrGuarantor: boolean | null
  outstandingJudgments: boolean | null
  delinquentFederalDebt: boolean | null
  partyToLawsuit: boolean | null
  deedInLieuPast7Years: boolean | null
  shortSalePast7Years: boolean | null
  foreclosurePast7Years: boolean | null
  bankruptcyPast7Years: boolean | null
  bankruptcyChapter7: boolean
  bankruptcyChapter11: boolean
  bankruptcyChapter12: boolean
  bankruptcyChapter13: boolean
  ethnicities: HmdaEthnicity[]
  ethnicityOtherText: string | null
  races: HmdaRace[]
  raceTribeText: string | null
  raceOtherAsianText: string | null
  raceOtherPacificIslanderText: string | null
  sexes: HmdaSex[]
  applicationMethod: ApplicationMethod | null
}

export const emptyDeclarations: Declarations = {
  willOccupyAsPrimary: null,
  ownedPropertyPast3Years: null,
  priorPropertyUsage: null,
  priorTitleHeld: null,
  familyRelationshipWithSeller: null,
  borrowingUndisclosedMoney: null,
  undisclosedMoneyAmount: null,
  applyingOtherMortgage: null,
  applyingNewCredit: null,
  subjectToPriorityLien: null,
  cosignerOrGuarantor: null,
  outstandingJudgments: null,
  delinquentFederalDebt: null,
  partyToLawsuit: null,
  deedInLieuPast7Years: null,
  shortSalePast7Years: null,
  foreclosurePast7Years: null,
  bankruptcyPast7Years: null,
  bankruptcyChapter7: false,
  bankruptcyChapter11: false,
  bankruptcyChapter12: false,
  bankruptcyChapter13: false,
  ethnicities: [],
  ethnicityOtherText: null,
  races: [],
  raceTribeText: null,
  raceOtherAsianText: null,
  raceOtherPacificIslanderText: null,
  sexes: [],
  applicationMethod: null,
}

export interface ApplicationBorrower {
  contactId: string
  role: 'primary' | 'co_borrower'
  person: PersonDetails
  addresses: Address[]
  employments: Employment[]
  otherIncomes: OtherIncome[]
  declarations: Declarations
}

export interface Application {
  borrowers: ApplicationBorrower[]
  assets: Asset[]
  liabilities: Liability[]
}

// ---------------------------------------------------------------------------
// Row conversion: snake_case columns <-> camelCase fields
// ---------------------------------------------------------------------------

/** Columns whose names don't follow the simple camelCase rule. */
const COLUMN_OVERRIDES: Record<string, string> = { accountLast4: 'account_last4' }

const toCamel = (column: string) => column.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
export const toSnake = (field: string) =>
  COLUMN_OVERRIDES[field] ??
  field
    .replace(/([a-z])([A-Z0-9])/g, '$1_$2')
    .replace(/([0-9])([A-Za-z])/g, '$1_$2')
    .toLowerCase()

/** Numeric columns arrive as strings from Postgres; these get converted back to numbers. */
const NUMERIC_FIELDS = new Set([
  'monthlyRent', 'baseIncome', 'overtimeIncome', 'bonusIncome', 'commissionIncome', 'militaryEntitlements',
  'otherEmploymentIncome', 'selfEmployedIncome', 'monthlyAmount', 'amount', 'unpaidBalance', 'monthlyPayment',
  'undisclosedMoneyAmount',
])

function fromRow<T>(row: Record<string, unknown>): T {
  const out: Record<string, unknown> = {}
  for (const [column, value] of Object.entries(row)) {
    const field = toCamel(column)
    out[field] = NUMERIC_FIELDS.has(field) ? num(value) : value
  }
  return out as T
}

function toRow(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values)
      .filter(([field]) => field !== 'id')
      .map(([field, value]) => [toSnake(field), typeof value === 'string' ? value.trim() || null : value]),
  )
}

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const PERSON_COLUMNS = [
  'first_name', 'middle_name', 'last_name', 'suffix', 'email', 'phone', 'home_phone', 'work_phone', 'work_phone_ext',
  'date_of_birth', 'citizenship', 'marital_status', 'dependents_count', 'dependents_ages', 'military_service',
  'military_active_duty', 'military_service_expires_on', 'military_retired', 'military_reserve_only', 'military_surviving_spouse',
].join(', ')

interface BorrowerRow {
  role: 'primary' | 'co_borrower'
  contact_id: string
  created_at: string
  contact: (Record<string, unknown> & {
    addresses: Record<string, unknown>[]
    employments: Record<string, unknown>[]
    other_incomes: Record<string, unknown>[]
  }) | null
  declarations: Record<string, unknown> | Record<string, unknown>[] | null
}

const ADDRESS_ORDER: Record<AddressKind, number> = { current: 0, former: 1, mailing: 2 }

/** Everything on the 1003 for one loan: borrowers (with person facts), assets and liabilities. */
export function useApplication(loanId: string) {
  return useQuery({
    queryKey: keys.application(loanId),
    queryFn: async (): Promise<Application> => {
      const [borrowerRows, assetRows, liabilityRows] = await Promise.all([
        db()
          .from('loan_borrowers')
          .select(
            `role, contact_id, created_at,
             contact:contacts!loan_borrowers_contact_id_fkey ( ${PERSON_COLUMNS}, addresses:contact_addresses ( * ), employments ( * ), other_incomes ( * ) ),
             declarations:borrower_declarations ( * )`,
          )
          .eq('loan_id', loanId),
        db().from('assets').select('*').eq('loan_id', loanId).order('created_at'),
        db().from('liabilities').select('*').eq('loan_id', loanId).order('created_at'),
      ])

      const borrowers = unwrap<BorrowerRow[]>(borrowerRows)
        .filter((b) => b.contact)
        .sort((a, b) => (a.role === b.role ? a.created_at.localeCompare(b.created_at) : a.role === 'primary' ? -1 : 1))
        .map((b): ApplicationBorrower => {
          const { addresses, employments, other_incomes, ...person } = b.contact!
          const decl = Array.isArray(b.declarations) ? b.declarations[0] : b.declarations
          return {
            contactId: b.contact_id,
            role: b.role,
            person: fromRow<PersonDetails>(person),
            addresses: addresses.map((r) => fromRow<Address>(r)).sort((x, y) => ADDRESS_ORDER[x.kind] - ADDRESS_ORDER[y.kind]),
            employments: employments
              .map((r) => fromRow<Employment>(r))
              .sort((x, y) => (x.status === y.status ? x.sortOrder - y.sortOrder || (y.startDate ?? '').localeCompare(x.startDate ?? '') : x.status === 'current' ? -1 : 1)),
            otherIncomes: other_incomes.map((r) => fromRow<OtherIncome>(r)),
            declarations: decl ? { ...emptyDeclarations, ...fromRow<Declarations>(decl) } : emptyDeclarations,
          }
        })

      return {
        borrowers,
        assets: unwrap<Record<string, unknown>[]>(assetRows).map((r) => fromRow<Asset>(r)),
        liabilities: unwrap<Record<string, unknown>[]>(liabilityRows).map((r) => fromRow<Liability>(r)),
      }
    },
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

function useInvalidateApplication(loanId: string) {
  const queryClient = useQueryClient()
  return () => {
    queryClient.invalidateQueries({ queryKey: keys.application(loanId) })
    // Names, phones and emails also show on the pipeline, contacts and profile header.
    queryClient.invalidateQueries({ queryKey: keys.loan(loanId) })
    queryClient.invalidateQueries({ queryKey: keys.pipeline })
    queryClient.invalidateQueries({ queryKey: keys.contacts })
  }
}

/** Saves person facts on the contact. */
export function useUpdatePerson(loanId: string) {
  const invalidate = useInvalidateApplication(loanId)
  return useMutation({
    mutationFn: async ({ contactId, changes }: { contactId: string; changes: Partial<PersonDetails> }) => {
      const rows = unwrap<{ id: string }[]>(await db().from('contacts').update(toRow(changes)).eq('id', contactId).select('id'))
      if (rows.length === 0) throw new Error('You do not have permission to edit this person.')
    },
    onSuccess: invalidate,
  })
}

type PersonTable = 'contact_addresses' | 'employments' | 'other_incomes'
type LoanTable = 'assets' | 'liabilities'

/**
 * Adds (no id) or updates (with id) a row in one of the 1003 list tables.
 * Person tables need the organization; loan tables are tied to the loan.
 */
export function useSaveRow(loanId: string, organizationId: string, table: PersonTable | LoanTable) {
  const invalidate = useInvalidateApplication(loanId)
  return useMutation({
    mutationFn: async ({ id, ...values }: { id?: string; contactId: string } & Record<string, unknown>) => {
      const row = toRow(values)
      if (id) {
        const rows = unwrap<{ id: string }[]>(await db().from(table).update(row).eq('id', id).select('id'))
        if (rows.length === 0) throw new Error('You do not have permission to edit this.')
        return
      }
      const owner = table === 'assets' || table === 'liabilities' ? { loan_id: loanId } : { organization_id: organizationId }
      unwrap(await db().from(table).insert({ ...row, ...owner }).select('id'))
    },
    onSuccess: invalidate,
  })
}

export function useDeleteRow(loanId: string, table: PersonTable | LoanTable) {
  const invalidate = useInvalidateApplication(loanId)
  return useMutation({
    mutationFn: async (id: string) => {
      const rows = unwrap<{ id: string }[]>(await db().from(table).delete().eq('id', id).select('id'))
      if (rows.length === 0) throw new Error('You do not have permission to delete this.')
    },
    onSuccess: invalidate,
  })
}

/** Saves changed declaration or demographic fields for one borrower (creates the row the first time). Only the given fields are written, so the two sections never overwrite each other. */
export function useSaveDeclarations(loanId: string) {
  const invalidate = useInvalidateApplication(loanId)
  return useMutation({
    mutationFn: async ({ contactId, values }: { contactId: string; values: Partial<Declarations> }) => {
      unwrap(
        await db()
          .from('borrower_declarations')
          .upsert({ ...toRow(values as unknown as Record<string, unknown>), loan_id: loanId, contact_id: contactId }, { onConflict: 'loan_id,contact_id' })
          .select('loan_id'),
      )
    },
    onSuccess: invalidate,
  })
}

/** Adds a co-borrower: an existing person (contact id) or a new one. */
export function useAddBorrower(loanId: string) {
  const invalidate = useInvalidateApplication(loanId)
  return useMutation({
    mutationFn: async (input: { firstName: string; lastName: string; email: string; phone: string; existingContactId: string | null }) =>
      unwrap<string>(
        await db().rpc('add_borrower', {
          p_loan_id: loanId,
          p_first_name: input.firstName,
          p_last_name: input.lastName,
          p_email: input.email,
          p_phone: input.phone,
          p_existing_contact_id: input.existingContactId,
        }),
      ),
    onSuccess: invalidate,
  })
}

/** Takes a co-borrower off this loan. Their person record (and other loans) stay. */
export function useRemoveBorrower(loanId: string) {
  const invalidate = useInvalidateApplication(loanId)
  return useMutation({
    mutationFn: async (contactId: string) => {
      const rows = unwrap<{ contact_id: string }[]>(
        await db().from('loan_borrowers').delete().eq('loan_id', loanId).eq('contact_id', contactId).eq('role', 'co_borrower').select('contact_id'),
      )
      if (rows.length === 0) throw new Error('Could not remove this co-borrower.')
    },
    onSuccess: invalidate,
  })
}
