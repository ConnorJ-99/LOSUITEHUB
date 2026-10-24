import type * as React from 'react'
import { cn } from 'cn'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { EmptyState, type EmptyStateProps } from './EmptyState'

export interface Column<Row> {
  key: string
  header: string
  cell: (row: Row) => React.ReactNode
  align?: 'left' | 'right'
  /** Hide this column on phones to keep the table readable. */
  hideOnMobile?: boolean
  className?: string
}

export interface DataTableProps<Row> {
  columns: Column<Row>[]
  rows: Row[]
  rowKey: (row: Row) => string
  onRowClick?: (row: Row) => void
  empty?: EmptyStateProps
  className?: string
}

/** Simple, typed table. Sorting/paging get added here once lists need them. */
export function DataTable<Row>({ columns, rows, rowKey, onRowClick, empty, className }: DataTableProps<Row>) {
  if (rows.length === 0 && empty) return <EmptyState {...empty} />

  const cellClass = (column: Column<Row>) =>
    cn(column.align === 'right' && 'text-right tabular-nums', column.hideOnMobile && 'hidden md:table-cell', column.className)

  return (
    <Table className={className}>
      <TableHeader>
        <TableRow>
          {columns.map((column) => (
            <TableHead key={column.key} className={cn('text-xs text-muted-foreground', cellClass(column))}>
              {column.header}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow
            key={rowKey(row)}
            onClick={onRowClick ? () => onRowClick(row) : undefined}
            className={cn(onRowClick && 'cursor-pointer')}
          >
            {columns.map((column) => (
              <TableCell key={column.key} className={cellClass(column)}>
                {column.cell(row)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
