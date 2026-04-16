import { Badge } from "@/components/ui/badge";

export function StatusBadge({ status }: { status: string }) {
  switch (status) {
    case 'open':
      return <Badge variant="outline" className="bg-[#FF9100]/15 text-[#FF9100] border-[#FF9100]/30">Open</Badge>;
    case 'closed':
      return <Badge variant="outline" className="bg-white/5 text-white/50 border-white/10">Closed</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export function PriorityBadge({ priority }: { priority: string }) {
  switch (priority) {
    case 'high':
      return <Badge variant="secondary" className="bg-red-900/20 text-red-400">High</Badge>;
    case 'medium':
      return <Badge variant="secondary" className="bg-white/10 text-white/60">Medium</Badge>;
    case 'low':
      return <Badge variant="secondary" className="bg-white/5 text-white/50 font-normal">Low</Badge>;
    default:
      return <Badge variant="secondary">{priority}</Badge>;
  }
}
