import {
  BuildingIcon,
  ComponentIcon,
  FileTextIcon,
  HandshakeIcon,
  PanelsTopLeftIcon,
  KanbanIcon,
  InboxIcon,
  MessagesSquareIcon,
  SearchIcon,
  SettingsIcon,
  SparklesIcon,
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
  /** Shown only to owners and admins (Connor, 2026-11-13). */
  adminOnly?: boolean
}

export const navSections: NavSection[] = [
  {
    items: [
      { to: '/', label: 'Today', icon: InboxIcon },
      { to: '/inbox', label: 'Inbox', icon: MessagesSquareIcon, unreadBadge: true },
      { to: '/assistant', label: 'Assistant', icon: SparklesIcon },
      { to: '/pipeline', label: 'Pipeline', icon: KanbanIcon },
      { to: '/contacts', label: 'Contacts', icon: UsersIcon },
      { to: '/partners', label: 'Partner center', icon: HandshakeIcon },
      { to: '/pages', label: 'Pages', icon: FileTextIcon },
      { to: '/product-search', label: 'Product Search', icon: SearchIcon },
    ],
  },
  {
    label: 'Admin',
  {
    items: [{ to: '/settings', label: 'Settings', icon: SettingsIcon }],
  },
    items: [
      { to: '/admin/lenders', label: 'Lenders', icon: BuildingIcon },
    adminOnly: true,
      { to: '/dev/components', label: 'Component Library', icon: ComponentIcon },
      { to: '/dev/loan-file', label: 'Loan File Preview', icon: PanelsTopLeftIcon },
    ],
  },
]
