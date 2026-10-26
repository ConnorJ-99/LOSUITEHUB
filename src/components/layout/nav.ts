import {
  BuildingIcon,
  ComponentIcon,
  PanelsTopLeftIcon,
  KanbanIcon,
  InboxIcon,
  SearchIcon,
  SettingsIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
}

export interface NavSection {
  label?: string
  items: NavItem[]
}

export const navSections: NavSection[] = [
  {
    items: [
      { to: '/', label: 'Today', icon: InboxIcon },
      { to: '/pipeline', label: 'Pipeline', icon: KanbanIcon },
      { to: '/contacts', label: 'Contacts', icon: UsersIcon },
      { to: '/product-search', label: 'Product Search', icon: SearchIcon },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/admin/lenders', label: 'Lenders & Programs', icon: BuildingIcon },
      { to: '/settings', label: 'Settings', icon: SettingsIcon },
      { to: '/dev/components', label: 'Component Library', icon: ComponentIcon },
      { to: '/dev/loan-file', label: 'Loan File Preview', icon: PanelsTopLeftIcon },
    ],
  },
]
