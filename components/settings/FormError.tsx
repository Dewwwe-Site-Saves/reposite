/** The banner a section shows when the save was refused. */
export function FormError({ message }: { message: string }) {
    return (
        <div className="rounded-md border border-destructive/20 bg-destructive-tint p-3 text-sm text-destructive">
            {message}
        </div>
    );
}
