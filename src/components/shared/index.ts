// Screens build forms and layouts from these shared components only, so the
// whole app looks and behaves the same. The raw shadcn primitives live in
// '@/components/ui' and are wrapped here.
export { Card, type CardProps } from './Card'
export { DataTable, type Column, type DataTableProps } from './DataTable'
export { DateInput, type DateInputProps } from './DateInput'
export { EmptyState, type EmptyStateProps } from './EmptyState'
export { Field, FormGrid, type FieldProps, type FieldSpan } from './Field'
export { Input, type InputProps } from './Input'
export { CurrencyInput, PercentInput, type CurrencyInputProps, type PercentInputProps } from './NumberInput'
export { PageHeader } from './PageHeader'
export { SearchInput, type SearchInputProps } from './SearchInput'
export { Select, type SelectOption, type SelectProps } from './Select'
export { SummaryBar, type SummaryBarProps, type SummaryItem } from './SummaryBar'
export { TextArea, type TextAreaProps } from './TextArea'
export { ToggleChip, ToggleChipGroup, type ToggleChipProps } from './ToggleChip'
export { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
