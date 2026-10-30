import {
  BuildingIcon,
  ComponentIcon,
  PanelsTopLeftIcon,
  KanbanIcon,
  InboxIcon,
  MessagesSquareIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Shows the count of unread texts and emails next to the label. */
  unreadBadge?: boolean
}

export interface NavSection {
  label?: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    items: [
      { to: '/', label: 'Today', icon: InboxIcon },
      { to: '/inbox', label: 'Inbox', icon: MessagesSquareIcon, unreadBadge: true },
      { to: '/pipeline', label: 'Pipeline', icon: KanbanIcon },
      { to: '/contacts', label: 'Contacts', icon: UsersIcon },
      { to: '/product-search', label: 'Product Search', icon: SearchIcon },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/admin/lenders', label: 'Lenders', icon: BuildingIcon },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
      { to: '/dev/components', label: 'Component Library', icon: ComponentIcon },
      { to: '/dev/loan-file', label: 'Loan File Preview', icon: PanelsTopLeftIcon },
    ],
  },
]
