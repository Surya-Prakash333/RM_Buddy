import React from 'react';
import clsx from 'clsx';

type SkeletonVariant = 'card' | 'table' | 'text';

interface LoadingSkeletonProps {
  variant?: SkeletonVariant;
  /** Number of repeated skeleton rows (for 'table' and 'text' variants). */
  rows?: number;
  className?: string;
}

// ── Reusable animated shimmer block ─────────────────────────────────────────

function ShimmerBlock({ className, style }: { className?: string; style?: React.CSSProperties }): JSX.Element {
  return (
    <div
      className={clsx(
        'bg-gray-200 rounded animate-pulse',
        className,
      )}
      style={style}
    />
  );
}

// ── Variants ─────────────────────────────────────────────────────────────────

function CardSkeleton(): JSX.Element {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-4">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <ShimmerBlock className="h-4 w-32" />
        <ShimmerBlock className="h-4 w-16" />
      </div>
      {/* Primary metric */}
      <ShimmerBlock className="h-8 w-24" />
      {/* Sub-line */}
      <ShimmerBlock className="h-3 w-48" />
    </div>
  );
}

function TableSkeleton({ rows = 5 }: { rows: number }): JSX.Element {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Table header */}
      <div className="flex items-center gap-4 px-4 py-3 border-b border-gray-100 bg-gray-50">
        {[40, 80, 60, 50, 30].map((w, i) => (
          <ShimmerBlock key={i} className={`h-3 w-${w}`} style={{ width: `${w}px` }} />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y divide-gray-50">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="flex items-center gap-4 px-4 py-3">
            {[60, 120, 80, 70, 40].map((w, colIdx) => (
              <ShimmerBlock
                key={colIdx}
                className="h-3 rounded"
                style={{ width: `${w}px` }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TextSkeleton({ rows = 3 }: { rows: number }): JSX.Element {
  // Widths vary to look like natural prose
  const widths = ['w-full', 'w-5/6', 'w-4/6', 'w-full', 'w-3/4', 'w-5/6'];

  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <ShimmerBlock key={i} className={clsx('h-3', widths[i % widths.length])} />
      ))}
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

/**
 * Animated skeleton placeholder used while async data is loading.
 *
 * @example
 * // Show 3 metric cards loading
 * <LoadingSkeleton variant="card" />
 *
 * @example
 * // Show a table with 8 rows loading
 * <LoadingSkeleton variant="table" rows={8} />
 */
export function LoadingSkeleton({
  variant = 'card',
  rows = 5,
  className,
}: LoadingSkeletonProps): JSX.Element {
  return (
    <div className={clsx('w-full', className)}>
      {variant === 'card' && <CardSkeleton />}
      {variant === 'table' && <TableSkeleton rows={rows} />}
      {variant === 'text' && <TextSkeleton rows={rows} />}
    </div>
  );
}
