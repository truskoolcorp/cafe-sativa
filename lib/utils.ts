import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/**
 * Merge class names with tailwind-merge conflict resolution.
 * Standard shadcn pattern — lets us do `cn('p-4', condition && 'p-6')`
 * and have `p-6` win.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
