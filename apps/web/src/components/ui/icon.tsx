import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  AlignLeft,
  AlertTriangle,
  ArrowLeft,
  Banknote,
  BarChart3,
  Bell,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Columns3,
  Database,
  FileText,
  Filter,
  Home,
  LayoutGrid,
  LogOut,
  Menu,
  Receipt,
  RefreshCw,
  Settings,
  Ticket,
  Upload,
  Users,
  UsersRound,
  Wrench,
  X,
} from 'lucide-react';

const ICONS = {
  // Nav items
  dashboard: LayoutGrid,
  properties: Home,
  persons: Users,
  leads: Filter,
  pipeline: Columns3,
  contracts: FileText,
  liquidaciones: Banknote,
  renditions: ClipboardList,
  invoices: Receipt,
  reports: BarChart3,
  services: Wrench,
  providers: UsersRound,
  tickets: Ticket,
  import: Upload,
  migration: Database,
  settings: Settings,
  delinquency: AlertTriangle,
  // UI chrome
  arrowLeft: ArrowLeft,
  menu: Menu,
  close: X,
  chevronRight: ChevronRight,
  chevronDown: ChevronDown,
  logout: LogOut,
  bell: Bell,
  collapse: AlignLeft,
  refresh: RefreshCw,
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, ...props }: { name: IconName } & LucideProps) {
  const Component: LucideIcon = ICONS[name];
  return <Component aria-hidden {...props} />;
}
