import type * as React from 'react'
import { cn } from 'cn'
import {
  Card as BaseCard,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

export interface CardProps {
  title?: string
  description?: string
  /** Buttons or links shown at the top right of the card. */
  action?: React.ReactNode
  className?: string
  contentClassName?: string
  children: React.ReactNode
}

/** White card with a soft shadow and an optional title row. */
export function Card({ title, description, action, className, contentClassName, children }: CardProps) {
  return (
    <BaseCard className={cn('shadow-soft ring-0', className)}>
      {(title || action) && (
        <CardHeader className="border-b">
          {title && <CardTitle>{title}</CardTitle>}
          {description && <CardDescription>{description}</CardDescription>}
          {action && <CardAction>{action}</CardAction>}
        </CardHeader>
      )}
      <CardContent className={contentClassName}>{children}</CardContent>
    </BaseCard>
  )
}
