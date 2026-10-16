'use client';

import { useState } from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { ViewIcon, ViewOffSlashIcon } from '@hugeicons/core-free-icons';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SECRET_MASK } from '@/lib/constants';

/** A stored secret is shown as a mask and left untouched unless "Replace" is clicked; the replacement is typed in clear. Stateless: the mask in `value` means "stored and untouched". */
export function SecretField({
    id,
    label,
    noun,
    placeholder,
    value,
    stored,
    onChange,
}: {
    id: string;
    label: string;
    /** How the help text names the secret. */
    noun: string;
    placeholder?: string;
    value: string;
    stored: boolean;
    onChange: (value: string) => void;
}) {
    const masked = stored && value === SECRET_MASK;
    const [revealed, setRevealed] = useState(false);

    return (
        <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                    <Input
                        id={id}
                        size="lg"
                        type="text"
                        autoComplete="off"
                        spellCheck={false}
                        // Keep password managers out of the field: the value is a server-side secret, not a login. Chrome's built-in manager has no opt-out, the others honor their attribute.
                        data-1p-ignore=""
                        data-lpignore="true"
                        data-bwignore="true"
                        data-form-type="other"
                        value={masked ? '' : value}
                        placeholder={masked ? `${SECRET_MASK} (stored)` : placeholder}
                        disabled={masked}
                        onChange={(e) => onChange(e.target.value)}
                        className={`pr-9 font-mono ${revealed || masked ? '' : 'secret-text'}`}
                    />
                    {/* Only what was just typed can be revealed: a stored secret never leaves the server. */}
                    {!masked && value && (
                        <button
                            type="button"
                            onClick={() => setRevealed((shown) => !shown)}
                            aria-label={revealed ? 'Hide the value' : 'Show the value'}
                            title={revealed ? 'Hide the value' : 'Show the value'}
                            className="absolute top-1/2 right-3 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                        >
                            <HugeiconsIcon
                                icon={revealed ? ViewOffSlashIcon : ViewIcon}
                                size={16}
                            />
                        </button>
                    )}
                </div>
                {stored && (
                    <Button
                        type="button"
                        variant="outline"
                        size="lg"
                        // The button sizes top out below the roomy field, so it is matched by hand.
                        className="h-10 shrink-0"
                        onClick={() => onChange(masked ? '' : SECRET_MASK)}
                    >
                        {masked ? 'Replace' : 'Keep stored'}
                    </Button>
                )}
            </div>
            {stored && !masked && (
                <p className="text-xs text-muted-foreground">
                    Leave empty to keep the stored {noun}.
                </p>
            )}
        </div>
    );
}
