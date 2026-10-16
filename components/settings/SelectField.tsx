import { HugeiconsIcon } from '@hugeicons/react';
import { ArrowDown01Icon } from '@hugeicons/core-free-icons';
import { Label } from '@/components/ui/label';

/** Label over a select drawn like the roomy input, chevron included (native selects hide their own). */
export function SelectField({
    id,
    label,
    children,
    ...props
}: React.ComponentProps<'select'> & { id: string; label: string }) {
    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <div className="relative">
                <select
                    id={id}
                    className="h-10 w-full appearance-none rounded-md border border-transparent bg-background pr-9 pl-3 text-xs/relaxed shadow-[inset_0_2px_4px_rgba(0,0,0,0.05)] transition-colors outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
                    {...props}
                >
                    {children}
                </select>
                <HugeiconsIcon
                    icon={ArrowDown01Icon}
                    size={16}
                    className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground"
                />
            </div>
        </div>
    );
}
