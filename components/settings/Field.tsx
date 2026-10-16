import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

/** Label over a roomy input, the field of the design. `hint` sits under it when the value needs explaining. */
export function Field({
    id,
    label,
    hint,
    className,
    ...props
}: React.ComponentProps<typeof Input> & { id: string; label: string; hint?: React.ReactNode }) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Input id={id} size="lg" className={className} {...props} />
            {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
        </div>
    );
}
