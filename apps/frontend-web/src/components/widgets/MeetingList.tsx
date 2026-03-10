import type { ReactElement, ReactNode } from 'react';
import { Video, Phone, User, Clock, Calendar } from 'lucide-react';
import type { MeetingItem, WidgetActionExtended } from '../../types/widget.types';

// ---------------------------------------------------------------------------
// Meeting type icons
// ---------------------------------------------------------------------------

const MEETING_ICON: Record<MeetingItem['meeting_type'], ReactNode> = {
  virtual: <Video className="w-4 h-4 text-blue-500" />,
  phone: <Phone className="w-4 h-4 text-green-500" />,
  in_person: <User className="w-4 h-4 text-purple-500" />,
};

const MEETING_TYPE_LABEL: Record<MeetingItem['meeting_type'], string> = {
  virtual: 'Virtual',
  phone: 'Phone',
  in_person: 'In Person',
};

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_BADGE: Record<MeetingItem['status'], string> = {
  scheduled: 'bg-blue-100 text-blue-700',
  completed: 'bg-green-100 text-green-700',
  cancelled: 'bg-gray-100 text-gray-500 line-through',
};

// ---------------------------------------------------------------------------
// Tier badge
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
// Component
// ---------------------------------------------------------------------------

interface MeetingListProps {
  title: string;
  data: { meetings: MeetingItem[] };
  actions?: WidgetActionExtended[];
  onAction?: (action: WidgetActionExtended) => void;
}

export function MeetingList({ title, data, actions, onAction }: MeetingListProps): ReactElement {
  const { meetings } = data;

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="font-semibold text-gray-800 text-sm">{title}</span>
          <span className="text-xs text-gray-400">({meetings.length})</span>
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

      {/* Meeting list */}
      {meetings.length === 0 ? (
        <div className="flex items-center justify-center py-10 text-sm text-gray-400">
          No meetings scheduled
        </div>
      ) : (
        <ul className="divide-y divide-gray-50">
          {meetings.map((meeting) => (
            <li
              key={meeting.meeting_id}
              className="px-4 py-3 hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-start gap-3">
                {/* Meeting type icon */}
                <div className="mt-0.5 flex-shrink-0">
                  {MEETING_ICON[meeting.meeting_type]}
                </div>

                <div className="flex-1 min-w-0">
                  {/* Top row: client name + tier + status */}
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-sm font-medium text-gray-800">{meeting.client_name}</span>
                    <span
                      className={[
                        'text-xs px-2 py-0.5 rounded-full font-medium',
                        tierBadgeClass(meeting.client_tier),
                      ].join(' ')}
                    >
                      {meeting.client_tier}
                    </span>
                    <span
                      className={[
                        'text-xs px-2 py-0.5 rounded-full font-medium capitalize',
                        STATUS_BADGE[meeting.status],
                      ].join(' ')}
                    >
                      {meeting.status}
                    </span>
                  </div>

                  {/* Time + duration + type */}
                  <div className="flex items-center gap-3 text-xs text-gray-500 mb-1">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {meeting.time}
                    </span>
                    <span>{meeting.duration_minutes} min</span>
                    <span>{MEETING_TYPE_LABEL[meeting.meeting_type]}</span>
                  </div>

                  {/* Agenda preview */}
                  <p className="text-xs text-gray-500 truncate">{meeting.agenda}</p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MeetingList;
