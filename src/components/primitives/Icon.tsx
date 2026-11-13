import {
  Lock,
  CalendarPlus,
  CalendarCheck,
  CalendarX,
  Hourglass,
  Award,
  Milestone,
  RotateCcw,
  ShieldAlert,
  Ban,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  LayoutDashboard,
  type LucideProps,
} from "lucide-react";

const MAP = {
  Lock,
  CalendarPlus,
  CalendarCheck,
  CalendarX,
  Hourglass,
  Award,
  Milestone,
  RotateCcw,
  ShieldAlert,
  Ban,
  Radio,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  LayoutDashboard,
} as const;

export type IconName = keyof typeof MAP;

export function Icon({ name, ...props }: { name: string } & LucideProps) {
  const Cmp = MAP[name as IconName] ?? Info;
  return <Cmp {...props} />;
}
