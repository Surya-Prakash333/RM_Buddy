import { useState } from 'react';
import type { ReactElement } from 'react';
import { ChevronUp, ChevronDown, Users } from 'lucide-react';
import type { ClientTableRow, WidgetActionExtended } from '../../types/widget.types';

// ---------------------------------------------------------------------------
// Tier badge classes
// ---------------------------------------------------------------------------

const TIER_BADGE: Record<string, string> = {
  Diamond: 'bg-purple-100 text-purple-700',
  Platinum: 'bg-gray-100 text-gray-700',
  Gold: 'bg-yellow-100 text-yellow-700',
  Silver: 'bg-blue-100 text-blue-600',
};

function tierBadgeClass(tier: string): string {
  return TIER_BADGE[tier] ?? 'bg-gray-100 text-gray-600';
}

// ---------------------------------------------------------------------------
// Sortable column definition
// ---------------------------------------------------------------------------

type SortKey = keyof ClientTableRow;
type SortDir = 'asc' | 'desc';

const COLUMNS: { key: SortKey; label: string; sortable: boolean }[] = [
  { key: 'client_name', label: 'Client Name', sortable: true },
  { key: 'tier', label: 'Tier', sortable: true },
  { key: 'aum', label: 'AUM', sortable: false },
  { key: 'last_interaction', label: 'Last Interaction', sortable: true },
];

function sortRows(rows: ClientTableRow[], key: SortKey, dir: SortDir): ClientTableRow[] {
  return [...rows].sort((a, b) => {
    const av = a[key] ?? '';
    const bv = b[key] ?? '';
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true });
    return dir === 'asc' ? cmp : -cmp;
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ClientTableProps {
  title: string;
  data: { clients: ClientTableRow[]; total?: number };
  actions?: WidgetActionExtended[];
  onAction?: (action: WidgetActionExtended, row?: ClientTableRow) => void;
  onRowClick?: (row: ClientTableRow) => void;
}

export function ClientTable({
  title,
  data,
  actions,
  onAction,
  onRowClick,
}: ClientTableProps): ReactElement {
  const [sortKey, setSortKey] = useState<SortKey>('client_name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function handleSort(key: SortKey): void {
    if (key === sortKey) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }

  const sorted = sortRows(Array.isArray(data.clients) ? data.clients : [], sortKey, sortDir);

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Users className="w-4 h-4 text-gray-400" />
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
          {data.total !== undefined && (
            <span className="text-xs text-gray-400">({data.total})</span>
          )}
        </div>

        {actions && actions.length > 0 && (
          <div className="flex items-center gap-2">
            {actions.map((action) => (
              <button
                key={action.label}
                type="button"
                onClick={() => onAction?.(action)}
                className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 transition-colors"
              >
                {action.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Table */}
      {sorted.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-sm text-gray-400">
          No clients found
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {COLUMNS.map((col) => (
                  <th
                    key={col.key}
                    className={[
                      'text-left px-4 py-2.5 text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap',
                      col.sortable ? 'cursor-pointer select-none hover:text-gray-800' : '',
                    ].join(' ')}
                    onClick={() => col.sortable && handleSort(col.key)}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {col.sortable && sortKey === col.key && (
                        sortDir === 'asc'
                          ? <ChevronUp className="w-3 h-3" />
                          : <ChevronDown className="w-3 h-3" />
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, idx) => (
                <tr
                  key={row.client_id}
                  onClick={() => onRowClick?.(row)}
                  className={[
                    'border-b border-gray-50 transition-colors',
                    onRowClick ? 'cursor-pointer hover:bg-gray-50' : '',
                    idx % 2 === 0 ? '' : 'bg-gray-50/40',
                  ].join(' ')}
                >
                  <td className="px-4 py-3 font-medium text-gray-800">{row.client_name}</td>
                  <td className="px-4 py-3">
                    <span
                      className={[
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        tierBadgeClass(row.tier),
                      ].join(' ')}
                    >
                      {row.tier}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{row.aum}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{row.last_interaction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default ClientTable;
