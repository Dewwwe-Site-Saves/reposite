import { Button } from '@/components/ui/button';

/** Shown by a section while its form differs from what is stored. The submit button is the form's own. */
export function UnsavedBar({ onDiscard, saving }: { onDiscard: () => void; saving: boolean }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-secondary p-5">
            <span className="flex items-center gap-1.5 text-sm font-medium">
                <span className="size-1.5 rounded-full bg-warning" />
                You have unsaved changes
            </span>
            <div className="flex items-center gap-3">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-primary"
                    onClick={onDiscard}
                    disabled={saving}
                >
                    Discard
                </Button>
                <Button type="submit" size="sm" disabled={saving}>
                    {saving ? 'Saving...' : 'Save changes'}
                </Button>
            </div>
        </div>
    );
}
