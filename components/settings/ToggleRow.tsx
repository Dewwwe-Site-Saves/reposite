'use client';

import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

/** A switch with its own title and explanation, sitting on a surface above the fields it governs. */
export function ToggleRow({
    id,
    title,
    description,
    checked,
    onCheckedChange,
}: {
    id: string;
    title: string;
    description: string;
    checked: boolean;
    onCheckedChange: (checked: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between gap-6 rounded-md bg-popover p-3.5">
            <div className="min-w-0">
                <Label htmlFor={id} className="text-sm">
                    {title}
                </Label>
                <p className="text-sm text-muted-foreground">{description}</p>
            </div>
            <span className="flex shrink-0 items-center gap-2 text-sm">
                <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} />
                {checked ? 'Enabled' : 'Disabled'}
            </span>
        </div>
    );
}
