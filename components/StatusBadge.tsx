import { Badge } from '@/components/ui/badge';

/** One badge per server status (`pending`, `running`, `success`, `error`, `cancelled`); null means "no backup yet". */
export function StatusBadge({ status }: { status: string | null }) {
    if (!status) {
        return <Badge variant="outline">NEVER</Badge>;
    }
    if (status === 'pending' || status === 'running') {
        return (
            <Badge variant="outline" className="animate-pulse border-primary text-primary">
                {status.toUpperCase()}
            </Badge>
        );
    }
    const variant =
        status === 'success' ? 'success' : status === 'error' ? 'destructive' : 'secondary';
    return <Badge variant={variant}>{status.toUpperCase()}</Badge>;
}
