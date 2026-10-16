/** No avatar image is stored: the initials of the address stand in for one. */
export function Avatar({ email, className = '' }: { email: string; className?: string }) {
    return (
        <span
            aria-hidden
            className={`inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-medium text-secondary-foreground ${className}`}
        >
            {initials(email)}
        </span>
    );
}

function initials(email: string): string {
    const parts = email
        .split('@')[0]
        .split(/[._-]+/)
        .filter(Boolean);
    if (parts.length === 0) return '?';
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
}
